module.exports = createGraphqlInterface;

const { graphql } = require('graphql');
const { parse } = require('graphql/language/parser');
const { makeExecutableSchema } = require('graphql-tools');
const mergeSchemas = require('./merge.js');
const loadSchema = require('./schema.js');
const buildTypeDef = require('./definition-builder.js');
const createResolvers = require('./resolvers.js');

// Utility exposures
createGraphqlInterface.graphql = graphql;

async function createGraphqlInterface({ data, definitions, graphqlOptions, common }) {
    const typeList = [];

    if (typeof common === 'string') {
        common = parseQl(common);
    }
    const defaultCommon = await loadSchema('common');

    // Next add the user defined definitions
    const schemas = definitions.map(processDefinition);

    // Finally link it all up
    const entryPoints = createEntryPoints();

    // Combine everything
    const typeDefs = mergeSchemas(defaultCommon, common, ...schemas, entryPoints);

    // Now we need resolvers
    const resolvers = await createResolvers(data, typeList);

    // Create the executable schema
    const executableSchema = makeExecutableSchema({
        ...graphqlOptions,
        typeDefs,
        resolvers
    });
    return executableSchema;

    function createEntryPoints() {
        return parseQl(`
            type Query {
                ${typeList.map(createQueryIdentifier).join('\n')}
            }

            type Mutation {
                ${typeList.map(createMutationIdentifier).join('\n')}
            }
        `);

        function createQueryIdentifier(info) {
            return `${info.name}: ${info.type}Query`;
        }

        function createMutationIdentifier(info) {
            return `${info.name}: ${info.type}Mutation`;
        }
    }

    function processDefinition(definition) {
        const parsed = typeof definition === 'string' ?
            parse(definition, graphqlOptions && graphqlOptions.parseOptions) :
            definition;

        if (!parsed || parsed.kind !== 'Document') {
            throw new Error('Not a valid GraphQL document (expected "root.kind to equal "Document". ' +
                `Got "${parsed && parsed.kind}").`);
        }

        const namesAndFields = namesFields(parsed);
        typeList.push({
            name: namesAndFields.identifierName,
            type: namesAndFields.typeName,
            id: namesAndFields.idName
        });
        return buildTypeDef({
            definition: parsed,
            ...namesAndFields
        });

    }

    function namesFields(definition) {
        // Get the primary definition and the name of the primary id field
        const firstType = firstTypeDefinition(definition);
        if (!firstType) {
            throw new Error('Expected a type defined at the root of the document');
        }
        const firstIdField = findFirstNonNullIdField(firstType);

        // Get the names
        const typeName = firstType.name.value;
        const identifierName = typeName[0].toLowerCase() + typeName.substr(1);
        const idName = firstIdField.name.value;

        return {
            idName,
            typeName,
            identifierName,
            fields: firstType.fields,
            dataFields: firstType.fields.filter(field => field !== firstIdField)
        };
    }

    function firstTypeDefinition(document) {
        switch (document && document.kind) {
            case 'Document':
                return document.definitions.find(firstTypeDefinition);
            case 'ObjectTypeDefinition':
                return document;
            default:
                return undefined;
        }
    }

    function findFirstNonNullIdField(firstType) {
        return firstType.fields.find(function isIdField(field) {
            return field &&
                field.type &&
                field.type.type &&
                field.type.type.name &&
                field.kind === 'FieldDefinition' &&
                field.type.kind === 'NonNullType' &&
                field.type.type.kind === 'NamedType' &&
                field.type.type.name.kind === 'Name' &&
                field.type.type.name.value === 'ID';
        });
    }

    function parseQl(str) {
        const parsed = parse(str, graphqlOptions && graphqlOptions.parseOptions);
        return parsed;
    }
}

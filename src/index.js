module.exports = createGraphqlInterface;

const Case = require('case');
const { parse, graphql } = require('graphql');
const { makeExecutableSchema } = require('graphql-tools');
const mergeSchemaSyntaxTrees = require('./merge-ast.js');
const loadSchema = require('./schema.js');
const createResolvers = require('./resolvers.js');
const { typeName, nameOf } = require('./util.js');

// Utility exposures (This helps with npm link development)
createGraphqlInterface.graphql = graphql;

async function createGraphqlInterface({ data, definitions, rootTypes, graphqlOptions, idFieldSelector }) {
    idFieldSelector = idFieldSelector || findFirstNonNullIdField;

    const typeList = [];
    const common = await loadSchema('common');

    if (Array.isArray(definitions)) {
        definitions = mergeSchemaSyntaxTrees({
            schemas: definitions,
            parseOptions: graphqlOptions && graphqlOptions.parseOptions
        });
    } else if (typeof definitions === 'string') {
        definitions = parseQl(definitions);
    }

    const rootTypeDefinitions = definitions.definitions
        .filter(definition => rootTypes.includes(nameOf(definition)));

    const generatedStructures = flatten(rootTypeDefinitions.map(generateRootTypeStructures));

    // Combine everything
    const typeDefs = mergeSchemaSyntaxTrees({
        schemas: [...generatedStructures, common, definitions],
        parseOptions: graphqlOptions && graphqlOptions.parseOptions
    });

    // Now we need resolvers
    const resolvers = await createResolvers(data, typeDefs, typeList);

    // Create the executable schema
    const executableSchema = makeExecutableSchema({
        ...graphqlOptions,
        typeDefs,
        resolvers
    });
    return executableSchema;

    function generateRootTypeStructures(type) {
        const namesAndFields = typeInfo(type);
        typeList.push({
            id: namesAndFields.idName,
            type: namesAndFields.type,
            name: namesAndFields.typeName,
            fields: namesAndFields.fields,
            idField: namesAndFields.idField,
            identifier: namesAndFields.identifierName
        });
        const ancillary = generateAncillaryStructures({
            type,
            idName: namesAndFields.idName,
            fields: namesAndFields.fields,
            idField: namesAndFields.idField
        });
        const entryPoints = createEntryPoints(namesAndFields.identifierName, namesAndFields.typeName);

        return [
            ancillary,
            entryPoints
        ];
    }

    function createEntryPoints(name, type) {
        // TODO: Subscription
        return parseQl(`
            type Query {
                ${name}: ${type}Query
            }

            type Mutation {
                ${name}: ${type}Mutation
            }
        `);
    }

    function generateAncillaryStructures({ type, idName, idField, fields }) {
        const definitionType = nameOf(type);
        const idFieldType = typeName(idField.type);
        const plainIdFieldType = idFieldType.endsWith('!') ?
            idFieldType.substring(0, idFieldType.length - 1) :
            idFieldType;

        return parseQl(`
            input ${definitionType}Input {
                ${fieldDefinitions(true)}
            }

            input ${definitionType}UpdateInput {
                ${fieldDefinitions(false)}
            }

            type ${definitionType}Edge {
                node: ${definitionType}!,
                cursor: ID!
            }

            type ${definitionType}Connection {
                edges: [${definitionType}Edge!]!,
                pageInfo: DataSourcePageInfo
            }

            type ${definitionType}Query {
                find(${idName}: ${idFieldType}): ${definitionType}
                list(
                    before: ID
                    after: ID
                    first: Int
                    last: Int
                    order: [DataSourceOrderInput!]
                    filter: [DataSourceFilterInput!]
                ): ${definitionType}Connection
            }

            type ${definitionType}Mutation {
                create(${idName}: ${plainIdFieldType}, data: ${definitionType}Input!): ${plainIdFieldType}!
                update(${idName}: ${idFieldType}, data: ${definitionType}UpdateInput!): Boolean
                upsert(${idName}: ${idFieldType}, data: ${definitionType}Input!): Boolean
                delete(${idName}: ${idFieldType}): Boolean
            }
        `);

        function fieldDefinitions(nonNull) {
            return fields.map(function createFieldSdl(field) {
                const fieldName = nameOf(field);
                const fieldType = `${nameOf(field.type)}${nonNull ? '!' : ''}`;
                return `${fieldName}: ${fieldType}`;
            }).join('\n');
        }
    }

    function typeInfo(type) {
        // Get the primary definition and the name of the primary id field
        const idField = idFieldSelector(type);

        // Get the names
        const typeName = nameOf(type);
        const identifierName = Case.camel(typeName);
        const idName = nameOf(idField);

        return {
            type,
            idName,
            typeName,
            identifierName,
            idField: idField,
            fields: type.fields
                .filter(field => field.kind === 'FieldDefinition')
                .filter(field => field !== idField)
                .map(field => ({
                    kind: 'FieldDefinition',
                    name: field.name,
                    type: field.type.kind === 'NonNullType' ?
                        field.type.type :
                        field.type
                }))
        };
    }

    function findFirstNonNullIdField(type) {
        return type.fields.find(function isIdField(field) {
            return field &&
                field.type &&
                field.type.type &&
                field.type.type.name &&
                field.kind === 'FieldDefinition' &&
                field.type.kind === 'NonNullType' &&
                field.type.type.kind === 'NamedType' &&
                nameOf(field.type.type) === 'ID';
        });
    }

    function parseQl(str) {
        try {
            const parsed = parse(str, graphqlOptions && graphqlOptions.parseOptions);
            return parsed;
        } catch (ex) {
            console.debug(str);
            throw ex;
        }
    }

    function flatten(arr) {
        const result = [];
        for (const element of arr) {
            if (Array.isArray(element)) {
                result.push(...element);
            } else {
                result.push(element);
            }
        }
        return result;
    }
}

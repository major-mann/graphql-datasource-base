module.exports = buildDefinition;

const { parse } = require('graphql/language/parser');
const mergeSchemas = require('./merge.js');

function buildDefinition({ definition, fields, dataFields, typeName, idName, graphqlOptions }) {
    // Create the input type only if one has not been supplied
    const isInputTypeDefined = definition.definitions.some(
        def => def.name && def.name.kind === 'Name' && def.name.value === `${typeName}Input`
    );
    const isUpsertInputTypeDefined = definition.definitions.some(
        def => def.name && def.name.kind === 'Name' && def.name.value === `${typeName}UpsertInput`
    );

    const inputType = !isInputTypeDefined ?
        buildInputType(false) :
        undefined;
    const inputUpdateType = !isUpdateInputTypeDefined ?
        buildInputType(true) :
        undefined;

    const schema = buildBaseSchema();

    const merged = mergeSchemas(definition, schema, inputType, inputUpdateType);
    return merged;

    function buildInputType(update) {
        const typeFields = (upsert && dataFields || fields)
            .filter(field => field.kind === 'FieldDefinition')
            .map(field => createInputField(field, !update));

        return parseql(`
            input ${typeName}${update ? 'Update' : ''}Input {
                ${typeFields.join('\n')}
            }
        `);
    }

    // TODO: Subscriptions

    function buildBaseSchema() {
        return parseql(`
            type ${typeName}Edge {
                node: ${typeName}!,
                cursor: ID!
            }

            type ${typeName}ListResponse {
                edges: [${typeName}Edge!]!,
                pageInfo: PageInfo
            }

            type ${typeName}Query {
                find(${idName}: ID!): ${typeName}
                list(
                    cursor: ID,
                    limit: Int,
                    order: [OrderInput!],
                    filter: [FilterInput!]
                ): ${typeName}ListResponse
            }

            type ${typeName}Mutation {
                create(${idName}: ID, data: ${typeName}Input!): ID!
                update(${idName}: ID!, data: ${typeName}UpdateInput!): Boolean
                upsert(${idName}: ID!, data: ${typeName}Input!): Boolean
                delete(${idName}: ID!): Boolean
            }
        `);
    }

    function createInputField(field, nonNull) {
        let fieldType;
        if (nonNull && fieldType.kind !== 'NonNullType') {
            fieldType = {
                kind: 'NonNullType',
                type: field.type
            };
        } else if (!nonNull && fieldType.kind === 'NonNullType') {
            fieldType = fieldType.type;
        } else {
            fieldType = field.type;
        }
        return `${field.name.value}: ${typeName(fieldType)}`;

        function typeName(type) {
            if (type.kind === 'NonNullType' && noForced) {
                return typeName(type.type);
            } else if (type.kind === 'NonNullType') {
                return `${typeName(type.type)}!`;
            } else {
                return type.name.value;
            }
        }
    }

    function parseql(str) {
        // str = `scaler Float\nscaler Int\nscaler ID\nscaler Boolean\n${str}`;
        const parsed = parse(str, graphqlOptions && graphqlOptions.parseOptions);
        // Do this for: https://github.com/apollographql/graphql-tools/issues/815
        // const schema = makeExecutableSchema({ typeDefs: parsed });
        return parsed;
    }
}
module.exports = createGraphqlInterface;

const Case = require('case');
const { SchemaComposer } = require('graphql-compose');

async function createGraphqlInterface({ data, definitions, rootTypes, idFieldSelector }) {
    idFieldSelector = idFieldSelector || findFirstNonNullIdField;

    const composer = new SchemaComposer();

    composer.addTypeDefs(`
        enum DataSourceFilterOperation {
            LT
            LTE
            EQ
            GTE
            GT
            CONTAINS
        }

        input DataSourceOrderInput {
            field: String!
            desc: Boolean!
        }

        input DataSourceFilterInput {
            field: String!
            op: DataSourceFilterOperation!
            value: String!
        }

        type DataSourcePageInfo {
            hasNextPage: Boolean
            hasPreviousPage: Boolean
        }
    `);

    if (Array.isArray(definitions)) {
        definitions.forEach(definition => composer.addTypeDefs(definition));
    } else if (typeof definitions === 'string') {
        composer.addTypeDefs(definition)
    }

    // Process the root types
    Array.from(composer.entries())
        .filter(entry => rootTypes.includes(entry[0]))
        .map(entry => processRootType(entry[1]));

    const composerSchema = composer.buildSchema();
    return composerSchema;

    function processRootType(typeComposer) {
        const typeName = typeComposer.getTypeName();
        const idFieldName = idFieldSelector(typeComposer);
        const idFieldType = typeComposer.getField(idFieldName).type;
        const plainIdFieldType = plainType(idFieldType);

        // TODO: get fields (nullable), excluding id field
        const fieldDefinitions = typeComposer.getFieldNames()
            .filter(fieldName => fieldName !== idFieldName)
            .map(fieldName => ({ name: fieldName, type: typeComposer.getFieldTC(fieldName) }));

        createInputType();
        createUpdateInputType();
        createListTypes();
        createQueryType();
        createMutationType();

        function createInputType() {
            const inputTypeName = `${typeName}Input`;
            if (composer.has(inputTypeName)) {
                // The consumer has defined a custom structure
                return;
            }
            composer.createInputTC({
                name: inputTypeName,
                fields: fieldDefinitions.reduce(function fieldReduce(result, fieldDefinition) {
                    result[fieldDefinition.name] = fieldDefinition.type.getType();
                    return result;
                }, {})
            });
        }

        function createUpdateInputType() {
            const inputTypeName = `${typeName}UpdateInput`;
            if (composer.has(inputTypeName)) {
                // The consumer has defined a custom structure
                return;
            }
            composer.createInputTC({
                name: inputTypeName,
                fields: fieldDefinitions.reduce(function fieldReduce(result, fieldDefinition) {
                    result[fieldDefinition.name] = fieldDefinition.type.getTypeNonNull();
                    return result;
                }, {})
            });
        }

        function createListTypes() {
            composer.createObjectTC({
                name: `${typeName}Edge`,
                fields: {
                    node: `${typeName}!`,
                    cursor: 'ID!'
                }
            });
            composer.createObjectTC({
                name: `${typeName}Connection`,
                fields: {
                    edges: `[${typeName}Edge!]!`,
                    pageInfo: 'DataSourcePageInfo!'
                }
            });
        }

        function createQueryType() {
            composer.createObjectTC({
                name: `${typeName}Query`,
                fields: {
                    find: {
                        resolve: find,
                        type: `${typeName}!`,
                        args: {
                            [idFieldName]: idFieldType
                        }

                    },
                    list: {
                        resolve: list,
                        type: `${typeName}Connection`,
                        args: {
                            before: 'ID',
                            after: 'ID',
                            first: 'Int',
                            last: 'Int',
                            order: '[DataSourceOrderInput!]',
                            filter: '[DataSourceFilterInput!]'
                        }
                    }
                }
            });

            composer.Query.addFields({
                [Case.camel(typeName)]: {
                    type: `${typeName}Query`,
                    resolve: () => ({})
                }
            });

            async function find(root, args) {
                const collection = await loadCollection();
                const record = await collection.find(args[idFieldName]);
                return record;
            }

            async function list(root, args) {
                const collection = await loadCollection();
                const first = args.first > 0 ?
                    Math.min(args.first, LIMIT) :
                    undefined;
                const last = args.last > 0 ?
                    Math.min(args.last, LIMIT) :
                    undefined;
                // TODO: Need to pass in selected fields so the query can be done intelligently
                const data = await collection.list({
                    filter: args.filter,
                    before: args.before,
                    after: args.after,
                    order: args.order,
                    first,
                    last
                });
                return data;
            }
        }

        function createMutationType() {
            // TODO: Need nullable id type...
            composer.createObjectTC({
                name: `${typeName}Mutation`,
                fields: {
                    create: {
                        type: idFieldType,
                        resolve: create,
                        args: {
                            [idFieldName]: plainIdFieldType,
                            data: `${typeName}Input!`
                        }
                    },
                    update: {
                        type: 'Boolean',
                        resolve: update,
                        args: {
                            [idFieldName]: idFieldType,
                            data: `${typeName}UpdateInput!`
                        }
                    },
                    upsert: {
                        type: 'Boolean',
                        resolve: upsert,
                        args: {
                            [idFieldName]: idFieldType,
                            data: `${typeName}Input!`
                        }
                    },
                    delete: {
                        type: 'Boolean',
                        resolve: remove,
                        args: {
                            [idFieldName]: idFieldType
                        }
                    }
                }
            });

            composer.Mutation.addFields({
                [Case.camel(typeName)]: {
                    type: `${typeName}Mutation`,
                    resolve: () => ({})
                }
            });

            async function create(root, args) {
                const collection = await loadCollection();
                const documentId = await collection.create(args[idFieldName], { ...args.data });
                return documentId;
            }

            async function upsert(root, args) {
                const collection = await loadCollection();
                await collection.upsert(args[idFieldName], { ...args.data });
            }

            async function update(root, args) {
                const collection = await loadCollection();
                const existing = await collection.find(args[idFieldName]);
                if (existing) {
                    await collection.update(args[idFieldName], { ...args.data });
                } else {
                    throw new Error(`Document with id "${args[idFieldName]}" in collection ` +
                        `"${name}" does not exist for update`);
                }
            }

            async function remove(root, args) {
                const collection = await loadCollection();
                await collection.delete(args[idFieldName]);
            }
        }

        async function loadCollection() {
            const collection = await data({
                id: idFieldName,
                type: composerSchema.getType(typeName),
                schema: composerSchema
            });
            return collection;
        }
    }

    function findFirstNonNullIdField(typeComposer) {
        return typeComposer.getFieldNames()
            .find(fieldName => typeComposer.getField(fieldName).type === 'ID!');
    }

    function plainType(type) {
        if (type.endsWith('!')) {
            return type.substr(0, type.length - 1);
        } else {
            return type;
        }
    }
}

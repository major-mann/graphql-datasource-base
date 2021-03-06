module.exports = createGraphqlInterface;

const Case = require(`case`);
const {
    SchemaComposer,
    ListComposer,
    NonNullComposer,
    ScalarTypeComposer,
    ObjectTypeComposer
} = require(`graphql-compose`);

async function createGraphqlInterface({ data, definitions, rootTypes, idFieldSelector, namespace, timestamps }) {
    namespace = namespace || ``;
    idFieldSelector = idFieldSelector || findFirstNonNullIdField;

    const composer = new SchemaComposer();

    composer.addTypeDefs(`
        enum DataSourceFilterOperation${namespace} {
            LT
            LTE
            EQ
            GTE
            GT
            CONTAINS
        }

        input DataSourceOrderInput${namespace} {
            field: String!
            desc: Boolean
        }

        input DataSourceFilterInput${namespace} {
            field: String!
            op: DataSourceFilterOperation!
            value: String!
        }

        type DataSourcePageInfo${namespace} {
            hasNextPage: Boolean
            hasPreviousPage: Boolean
        }
    `);

    if (Array.isArray(definitions)) {
        definitions.forEach(definition => composer.addTypeDefs(definition));
    } else if (typeof definitions === `string`) {
        composer.addTypeDefs(definitions);
    }

    // Process the root types
    Array.from(composer.entries())
        .filter(entry => rootTypes.includes(entry[0]))
        .map(entry => processRootType(entry[1]));

    return composer;

    function processRootType(typeComposer) {
        const typeName = typeComposer.getTypeName();
        const idFieldName = idFieldSelector(typeComposer);
        const idFieldType = typeComposer.getField(idFieldName).type;
        const plainIdFieldType = plainType(idFieldType);

        const fieldDefinitions = createFieldDefinitions(typeComposer);

        createInputType(typeName, fieldDefinitions);
        createUpdateInputType(typeName, fieldDefinitions);
        createListTypes();
        createQueryType();
        createMutationType();

        if (timestamps) {
            createTimestampFields(typeComposer);
        }

        function createListTypes() {
            composer.createObjectTC({
                name: `${typeName}Edge`,
                fields: {
                    node: `${typeName}!`,
                    cursor: `ID!`
                }
            });
            composer.createObjectTC({
                name: `${typeName}Connection`,
                fields: {
                    edges: `[${typeName}Edge!]!`,
                    pageInfo: `DataSourcePageInfo${namespace}!`
                }
            });
        }

        function createQueryType() {
            const queryObject =  composer.createObjectTC({ name: `${typeName}Query` })
                .addResolver({
                    name: `$find`,
                    resolve: find,
                    type: typeName,
                    args: {
                        [idFieldName]: idFieldType
                    }
                })
                .addResolver({
                    name: `$list`,
                    resolve: list,
                    type: `${typeName}Connection`,
                    args: {
                        before: `ID`,
                        after: `ID`,
                        first: `Int`,
                        last: `Int`,
                        order: `[DataSourceOrderInput${namespace}!]`,
                        filter: `[DataSourceFilterInput${namespace}!]`
                    }
                });

            queryObject.addFields({
                find: queryObject.getResolver(`$find`),
                list: queryObject.getResolver(`$list`)
            });

            composer.Query.addFields({
                [Case.camel(typeName)]: {
                    type: `${typeName}Query`,
                    resolve: () => ({})
                }
            });

            async function find({ args }) {
                const collection = await loadCollection();
                const record = await collection.find(args[idFieldName]);
                return record;
            }

            async function list({ args }) {
                const collection = await loadCollection();
                const first = args.first > 0 ?
                    args.first :
                    undefined;
                const last = args.last > 0 ?
                    args.last :
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
            const mutationObject = composer.createObjectTC({ name: `${typeName}Mutation` })
                .addResolver({
                    name: `$create`,
                    type: idFieldType,
                    resolve: create,
                    args: {
                        [idFieldName]: plainIdFieldType,
                        data: `${typeName}Input!`
                    }
                })
                .addResolver({
                    name: `$update`,
                    type: `Boolean`,
                    resolve: update,
                    args: {
                        [idFieldName]: idFieldType,
                        data: `${typeName}UpdateInput!`
                    }
                })
                .addResolver({
                    name: `$upsert`,
                    type: `Boolean`,
                    resolve: upsert,
                    args: {
                        [idFieldName]: idFieldType,
                        data: `${typeName}Input!`
                    }
                })
                .addResolver({
                    name: `$delete`,
                    type: `Boolean`,
                    resolve: remove,
                    args: {
                        [idFieldName]: idFieldType
                    }
                });
            mutationObject.addFields({
                create: mutationObject.getResolver(`$create`),
                update: mutationObject.getResolver(`$update`),
                upsert: mutationObject.getResolver(`$upsert`),
                delete: mutationObject.getResolver(`$delete`)
            });

            composer.Mutation.addFields({
                [Case.camel(typeName)]: {
                    type: `${typeName}Mutation`,
                    resolve: () => ({})
                }
            });

            async function create({ context, args }) {
                const collection = await loadCollection(context);
                const data = {
                    ...args.data
                };
                if (timestamps) {
                    data.created = data.modified = Date.now();
                }
                const documentId = await collection.create(args[idFieldName], data);
                return documentId;
            }

            async function upsert({ context, args }) {
                const collection = await loadCollection(context);
                const data = {
                    ...args.data
                };
                if (timestamps) {
                    const existing = await collection.find(args[idFieldName]);
                    const now = Date.now();
                    if (!existing) {
                        data.created = now;
                    }
                    data.modified = now;
                }
                await collection.upsert(args[idFieldName], data);
            }

            async function update({ context, args }) {
                const collection = await loadCollection(context);
                const existing = await collection.find(args[idFieldName]);
                if (existing) {
                    const data = {
                        ...args.data
                    };
                    if (timestamps) {
                        data.modified = Date.now();
                    }
                    await collection.update(args[idFieldName], data);
                } else {
                    throw new Error(`Document with id "${args[idFieldName]}" in collection ` +
                        `"${typeName}" does not exist for update`);
                }
            }

            async function remove({ context, args }) {
                const collection = await loadCollection(context);
                await collection.delete(args[idFieldName]);
            }
        }

        async function loadCollection(context) {
            const collection = await data({
                id: idFieldName,
                name: typeName,
                type: composer.getOTC(typeName),
                schema: composer,
                context
            });
            return collection;
        }
    }

    function createInputTypeFromType(typeComposer) {
        return createInputTypeComposerFromType(typeComposer, createInputType);
    }

    function createUpdateInputTypeFromType(typeComposer) {
        return createInputTypeComposerFromType(typeComposer, createUpdateInputType);
    }

    function createInputTypeComposerFromType(typeComposer, create) {
        const typeName = typeComposer.getTypeName();
        const fieldDefinitions = createFieldDefinitions(typeComposer);
        return create(typeName, fieldDefinitions);
    }

    function createInputType(typeName, fieldDefinitions) {
        const inputTypeName = `${typeName}Input`;
        return createInputTypeComposer(inputTypeName, fieldDefinitions, value => value, createInputTypeFromType);
    }

    function createUpdateInputType(typeName, fieldDefinitions) {
        const inputTypeName = `${typeName}UpdateInput`;
        return createInputTypeComposer(inputTypeName, fieldDefinitions, nullableType, createUpdateInputTypeFromType);
    }

    function createInputTypeComposer(inputTypeName, fieldDefinitions, transformType, recursive) {
        if (composer.has(inputTypeName)) {
            // The consumer has defined a custom structure
            return composer.getITC(inputTypeName);
        }
        const typeComposer = composer.createInputTC({
            name: inputTypeName,
            fields: fieldDefinitions.reduce(function fieldReduce(result, fieldDefinition) {
                const inputType = getInputFieldType(
                    fieldDefinition.typeComposer,
                    recursive
                );
                result[fieldDefinition.name] = typeName(transformType(inputType));
                return result;
            }, {})
        });
        return typeComposer;
    }

    function getInputFieldType(typeComposer, recursive) {
        if (isScalarType(typeComposer)) {
            return typeComposer;
        }

        if (isNonNull(typeComposer)) {
            return new NonNullComposer(getInputFieldType(typeComposer.ofType, recursive));
        }
        if (isList(typeComposer)) {
            return new ListComposer(getInputFieldType(typeComposer.ofType, recursive));
        }

        // We only want to create the special input type for objects
        if (typeComposer instanceof ObjectTypeComposer === false) {
            return typeComposer;
        }

        const newInputType = recursive(typeComposer);
        return newInputType;
    }

    function createFieldDefinitions(typeComposer) {
        const idFieldName = idFieldSelector(typeComposer);
        return typeComposer.getFieldNames()
            .filter(fieldName => fieldName !== idFieldName)
            .map(function (fieldName) {
                return {
                    name: fieldName,
                    typeComposer: typeComposer.getField(fieldName).type
                };
            });
    }

    function createTimestampFields(typeComposer) {
        if (!typeComposer.hasField(`created`)) {
            typeComposer.addFields({ created: `Float!` });
        }
        if (!typeComposer.hasField(`modified`)) {
            typeComposer.addFields({ modified: `Float!` });
        }
    }

    function findFirstNonNullIdField(typeComposer) {
        return typeComposer.getFieldNames()
            .find(fieldName => typeName(typeComposer.getField(fieldName).type) === `ID!`);
    }

    function plainType(type) {
        if (type instanceof NonNullComposer) {
            return plainType(type.ofType);
        } else if (type instanceof ListComposer) {
            return type.ofType;
        } else {
            return type;
        }
    }

    function typeName(type) {
        if (typeof type === `string`) {
            return type;
        } else if (typeof type.getTypeName === `function`) {
            return type.getTypeName();
        } else if (type instanceof NonNullComposer) {
            return `${typeName(type.ofType)}!`;
        } else if (type instanceof ListComposer) {
            return `[${typeName(type.ofType)}]`;
        }/* else if (type.name) {
            return type.name;
        }*/ else {
            throw new Error(`Unable to determine type name`);
        }
    }

    function nullableType(type) {
        if (type.ofType) {
            return type.ofType;
        } else {
            return type;
        }
    }

    function isNonNull(type) {
        return type instanceof NonNullComposer;
    }

    function isList(type) {
        if (type instanceof NonNullComposer) {
            return isList(type.ofType);
        } else {
            return type instanceof ListComposer;
        }
    }

    function isScalarType(type) {
        return type instanceof ScalarTypeComposer;
    }
}

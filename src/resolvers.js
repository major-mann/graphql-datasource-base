module.exports = createResolvers;

const LIMIT = 100;

async function createResolvers(data, types) {
    // TODO: Subscription
    const result = {
        Query: {},
        Mutation: {}
    };
    await Promise.all(types.map(processType));
    return result;

    async function processType(type) {
        await Promise.all([
            createQueryResolver(type),
            createMutationResolver(type)
        ]);
    }

    async function createQueryResolver(info) {
        result.Query[info.name] = () => ({});
        result[`${info.type}Query`] = await buildQueryResolver(info);
    }

    async function createMutationResolver(info) {
        // Return a blank object which will have the fields resolved by the type resolvers
        result.Mutation[info.name] = () => ({});
        result[`${info.type}Mutation`] = await buildMutationResolver(info);
    }

    async function buildMutationResolver({ name, id }) {
        const collection = await data(name, id);
        return {
            create,
            update,
            upsert,
            delete: remove
        };

        async function create(root, args) {
            const documentId = await collection.create(args[id], { ...args.data });
            return documentId;
        }

        async function upsert(root, args) {
            await collection.upsert(args[id], { ...args.data });
        }

        async function update(root, args) {
            const existing = await collection.find(args[id]);
            if (existing) {
                await collection.update(args[id], { ...args.data });
            } else {
                throw new Error(`Document with id "${args[id]}" in collection "${name}" does not exist for update`);
            }
        }

        async function remove(root, args) {
            await collection.delete(args[id]);
        }

    }

    async function buildQueryResolver({ name, id }) {
        const collection = await data(name, id);
        return {
            find,
            list
        };

        async function find(root, args) {
            const data = await collection.find(args[id]);
            return data;
        }

        async function list(root, args, context, info) {
            const limit = args.limit > 0 ?
                Math.min(args.limit, LIMIT) :
                LIMIT;
            // TODO: Need to pass in selected fields so the query can be done intelligently
            const data = await collection.list({
                filter: args.filter,
                order: args.order,
                cursor: args.cursor,
                limit
            });
            return data;
        }
    }
}

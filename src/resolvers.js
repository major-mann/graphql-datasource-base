module.exports = createResolvers;

const LIMIT = 100;

async function createResolvers(data, definition, types) {
    // TODO: Subscription
    const result = {
        Query: {},
        Mutation: {}
    };
    await Promise.all(types.map(processType));
    return result;

    async function processType(info) {
        await Promise.all([
            createQueryResolver(info),
            createMutationResolver(info)
        ]);
    }

    async function createQueryResolver(info) {
        result.Query[info.identifier] = () => ({});
        result[`${info.name}Query`] = await buildQueryResolver(info);
    }

    async function createMutationResolver(info) {
        // Return a blank object which will have the fields resolved by the type resolvers
        result.Mutation[info.identifier] = () => ({});
        result[`${info.name}Mutation`] = await buildMutationResolver(info);
    }

    async function buildMutationResolver({ name, id, type }) {
        const collection = await data({
            id,
            name,
            type,
            definition,
        });
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

    async function buildQueryResolver({ name, id, type }) {
        const collection = await data({
            id,
            name,
            type,
            definition,
        });
        return {
            find,
            list
        };

        async function find(root, args) {
            const data = await collection.find(args[id]);
            return data;
        }

        async function list(root, args) {
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
}

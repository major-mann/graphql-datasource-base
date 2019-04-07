module.exports = mergeAst;

const MERGEABLE = ['Query', 'Mutation', 'Subscription'];

const merge = require('@major-mann/graphql-tool-merge-ast');

function mergeAst({ typeDefs, parseOptions }) {
    return merge({
        typeDefs,
        parseOptions,
        onTypeConflict
    });

    function onTypeConflict(type1, type2) {
        if (MERGEABLE.includes(type1.name.value)) {
            return true;
        } else {
            return type2;
        }
    }
}

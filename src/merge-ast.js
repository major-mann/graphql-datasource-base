module.exports = merge;

const MERGEABLE = ['Query', 'Mutation', 'Subscription'];

const { parse } = require('graphql');

function merge({ schemas, parseOptions }) {
    schemas = schemas.map(prepareSchema);
    return {
        kind: 'Document',
        definitions: mergeAll(schemas)
    };

    function handleTypeConflict(type1, type2) {
        if (MERGEABLE.includes(nameOf(type1))) {
            return {
                kind: 'ObjectTypeDefinition',
                name: type1.name,
                directives: nameMerge(type1.directives, type2.directives),
                interfaces: nameMerge(type1.interfaces, type2.interfaces),
                fields: nameMerge(type1.fields, type2.fields)
            }
        } else {
            return type2;
        }
    }

    function mergeAll(definitions) {
        let result = definitions[0];
        for (var definitionIndex = 1; definitionIndex < definitions.length; definitionIndex++) {
            result = mergeDefinitions(result, definitions[definitionIndex]);
        }
        return result;
    }

    function mergeDefinitions(definitions1, definitions2) {
        const result = definitions1.slice();
        for (var definitionIndex = 0; definitionIndex < definitions2.length; definitionIndex++) {
            const definition = definitions2[definitionIndex];
            const typeIndex = findTypeIndex(result, nameOf(definition));
            if (typeIndex === -1) {
                result.push(definition);
            } else {
                const resolved = handleTypeConflict(result[typeIndex], definition);
                if (resolved) {
                    result[typeIndex] = resolved;
                }
            }
        }
        return result;
    }

    function findTypeIndex(definitions, name) {
        for (var definitionIndex = 0; definitionIndex < definitions.length; definitionIndex++) {
            if (nameOf(definitions[definitionIndex]) === name) {
                return definitionIndex;
            }
        }
        return -1;
    }

    function prepareSchema(schema) {
        if (typeof schema === 'string') {
            schema = parse(schema, parseOptions);
        }
        if (schema.kind !== 'Document') {
            throw new Error('Supplied schemas MUST be or MUST parse to Document');
        }
        return schema.definitions;
    }
}

/** Overwrites items with the same name in 1 with items from 2, and adds all items that don't exist */
function nameMerge(namedNodes1, namedNodes2) {
    if (!namedNodes1 && !namedNodes2) {
        return undefined;
    }
    if (!namedNodes1) {
        return namedNodes2.slice();
    }
    if (!namedNodes2) {
        return namedNodes1.slice();
    }
    const result = namedNodes1.slice();
    namedNodes2.forEach(processNode);
    return result;

    function processNode(node2) {
        const node2Name = nameOf(node2);
        const currentIndex = result.findIndex(node1 => nameOf(node1) === node2Name);
        if (currentIndex === -1) {
            result.push(node2);
        } else {
            result[currentIndex] = node2;
        }
    }
}

function nameOf(node) {
    if (node && node.name && node.name.kind === 'Name') {
        return node.name.value;
    } else {
        throw new Error('Unable to get name for node');
    }
}

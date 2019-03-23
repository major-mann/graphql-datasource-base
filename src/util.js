module.exports = { typeName, nameOf };

function typeName(node) {
    if (node.kind === 'NonNullType') {
        return `${typeName(node.type)}!`;
    } else {
        return nameOf(node);
    }
}

function nameOf(node) {
    if (node && node.name && node.name.kind === 'Name') {
        return node.name.value;
    } else {
        throw new Error('Unable to get name for node');
    }
}
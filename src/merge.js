module.exports = mergeSchemas;

const MERGEABLE = ['Query', 'Mutation', 'Subscription'];

function mergeSchemas(...schemas) {
    let result;
    do {
        result = schemas.shift();
    } while (schemas.length && !result);

    for (var schemaIndex = 0; schemaIndex < schemas.length; schemaIndex++) {
        if (schemas[schemaIndex]) {
            result = mergePair(result, schemas[schemaIndex]);
        }
    }
    return result;

    function mergePair(schema1, schema2) {
        // 2 overwrites 1 unless it is the Query or Mutation object definitions in which case they are merged.
        const definitions = mergeDefinitions();
        return {
            kind: 'Document',
            definitions
        };

        function mergeDefinitions() {
            const result = schema2.definitions.slice();
            schema1.definitions.forEach(function processDefinition(definition) {
                const defIndex = result.findIndex(
                    def => def.kind === 'ObjectTypeDefinition' &&
                        def.name.kind === 'name' &&
                        def.name.value === definition.name.value
                );
                if (defIndex === -1) {
                    result.push(definition);
                    return;
                }

                if (definition.kind !== 'ObjectTypeDefinition' || definition.name.kind !== 'Name' ||
                    MERGEABLE.includes(definition.name.value) === false) {
                    return;
                }

                result[defIndex] = mergeObjectDefinition(definition, result[defIndex]);
            });
            return result;
        }

        function mergeObjectDefinition(def1, def2) {
            const fields = mergeFields();
            return {
                kind: def2.kind,
                description: def2.description,
                name: def2.name,
                interfaces: def2.interfaces,
                directives: def2.directives,
                fields
            };

            function mergeFields() {
                const fields = def1.fields.slice();
                def1.fields.forEach(function mergeField(field1) {
                    if (def2.fields.some(field2 => sameField(field1, field2)) === false) {
                        fields.push(field1);
                    }
                });
                return fields;

                function sameField(field1, field2) {
                    return field1.name.kind === field2.name.kind && field1.name.value === field2.name.value;
                }
            }
        }
    }
}

module.exports = loadSchema;

const fs = require('fs');
const path = require('path');
const { parse } = require('graphql/language/parser');

async function loadSchema(name) {
    const schemaLocation = path.join(__dirname, `../schema/${name}.gql`);
    const schemaSource = await readSchema();
    const schema = parse(schemaSource);
    return schema;

    function readSchema() {
        return new Promise(function promiseHandler(resolve, reject) {
            fs.readFile(schemaLocation, { encoding: 'utf8' }, function onFileRead(err, data) {
                if (err) {
                    reject(err);
                } else {
                    resolve(data);
                }
            });
        });
    }
}

# Graphql datasource base
This provides a generic structure for exposing a data source's contents using graphql. This project is not intended
for end use, but is intended to serve as a base for other projects. A project wishing to provide a data source should
implement the following functions to pass to the `data` parameter of the main creation function.

    const graphql = require('graphql');
    const createDatasource = require('@major-mann/graphql-datasource-base');
    const schema = createDataSource({ data: initializeData(), definitions: [
        `
        type MyCollection1 {
            myCollection1Id: ID!
            name: String!
            modified: Int!
        }
        `,
        `
        type MyCollection2 {
            myCollection2Id: ID!
            name: String!
            modified: Int!
        }
        `
    ] });

    const result = await graphql(`
        query {
            myCollection1 {
                list {
                    myCollection1Id
                    name
                    modified
                }
            }
        }
    `);

    function initializeData() {
        return {
            find,
            list,
            create,
            upsert,
            update,
            delete: remove
        }

        async function find(id) {
            // ...
        }

        async function list({ cursor, limit, filter, order }) {
            // ...
        }

        async function create(id, data) {
            // ...
        }

        async function upsert(id, data) {
            // ...
        }

        async function update(id, data) {
            // ...
        }

        async function remove(id) {
            // ...
        }
    }


* [TODO: More info]
* [TODO: Link Sample implementation (firebase?)]

## Sample SQL
SDL is generated based on the definitions passed. This assumes a supplied definition of:

    type Test {
        testId: ID!
        name: String!
    }

This should generate something like the following

    enum Operation {
        LT
        LTE
        E
        GTE
        GT
        LESS_THAN
        LESS_THAN_EQUAL
        EQUAL
        GREATER_THAN_EQUAL
        GREATER_THAN
        CONTAINS
    }

    input OrderInput {
        field: String!
        desc: Boolean!
    }

    input FilterInput {
        field: String!
        op: Operation!
        value: String!
    }

    type PageInfo {
        previousPage: ID
        nextPage: ID
    }

    type Test {
        testId: ID!
        name: String!
    }

    type TestInput {
        name: String
    }

    type TestUpsertInput {
        name: String!
    }

    type TestEdge {
        node: Test!,
        cursor: ID!
    }

    type TestListResponse {
        edges: [TestEdge!]!,
        pageInfo: PageInfo
    }

    type TestQuery {
        find(testId: ID!): Test
        list(
            cursor: ID,
            limit: Int,
            order: [OrderInput!],
            filter: [FilterInput!]
        ): TestListResponse
    }

    type TestMutation {
        create(testId: ID, data: TestInput!): ID!
        update(testId: ID!, data: TestUpdateInput!): Boolean
        upsert(testId: ID!, data: TestUpsertInput!): Boolean
        delete(testId: ID!): Boolean
    }

    type Query {
        test: TestQuery
    }

    type Mutation {
        test: TestMutation
    }

Multiple definitions will be merged together with the common definitions passed in and the generated definitions
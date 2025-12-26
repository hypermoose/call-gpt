// create metadata for all the available functions to pass to completions API
const tools = [
  {
    type: 'function',
    name: 'checkInventory',
    say: 'Let me check our inventory right now.',
    description: 'Check the inventory of airpods, airpods pro or airpods max.',
    parameters: {
      type: 'object',
      properties: {
        model: {
          type: 'string',
          'enum': ['airpods', 'airpods pro', 'airpods max'],
          description: 'The model of airpods, either the airpods, airpods pro or airpods max',
        },
      },
      required: ['model'],
    },
    returns: {
      type: 'object',
      properties: {
        stock: {
          type: 'integer',
          description: 'An integer containing how many of the model are in currently in stock.'
        }
      }
    }
  },
];

module.exports = tools;
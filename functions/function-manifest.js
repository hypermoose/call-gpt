// create metadata for all the available functions to pass to completions API
const tools = [
  {
    type: 'web_search',
    user_location: {
      type: "approximate",
      country: "US",
      region: "Washington",
      city: "Redmond"
    }
  },
  {
    type: 'function',
    name: 'currentTime',
    say: '',
    description: 'Gets the current local time'
  }
];

module.exports = tools;
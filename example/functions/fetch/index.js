const Handler = require('@serverless-workspaces-plugin-example/handler');

module.exports.get = Handler(async (req, res) => {
  return res.json({
    hello: 'from fetch',
  });
});

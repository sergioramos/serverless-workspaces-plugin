const Handler = require('@serverless-workspaces-plugin-example/handler');

module.exports.put = Handler(async (req, res) => {
  return res.json({
    hello: 'from update',
  });
});

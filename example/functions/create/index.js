const Handler = require('@serverless-workspaces-plugin-example/handler');

module.exports.post = Handler(async (req, res) => {
  return res.json({
    hello: 'from create',
  });
});

const Handler = require('@serverless-workspaces-plugin-example/handler');

module.exports['delete'] = Handler(async (req, res) => {
  return res.json({
    hello: 'from remove',
  });
});

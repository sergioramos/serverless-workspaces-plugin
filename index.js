const { default: Filter } = require('apr-filter');
const { default: ForEach } = require('apr-for-each');
const Intercept = require('apr-intercept');
const Reduce = require('apr-reduce');
const Execa = require('execa');
const Globby = require('globby');
const Resolve = require('resolve-pkg');
const { join, dirname } = require('path');

const {
  symlink,
  unlink,
  ensureDir,
  readdir,
  stat,
  copy,
  ensureFile,
  remove,
} = require('fs-extra');

const Link = async (target, path) => {
  await ensureDir(dirname(path));
  await Intercept(symlink(target, path));
};

const Unlink = async location => {
  await Intercept(unlink(location));
};

module.exports = class ServerlessLernaPlugin {
  constructor(serverless, options) {
    const { config } = serverless;
    const { servicePath } = config;

    this.serverless = serverless;
    this.log = msg => serverless.cli.log(msg);
    this.cwd = servicePath;
    this.options = options;

    this.hooks = {
      'package:cleanup': this.cleanup.bind(this),
      'package:initialize': this.initialize.bind(this),
      'after:package:initialize': this.copyWorkspaces.bind(this),
      'after:package:finalize': this.cleanup.bind(this),
    };
  }

  async getWorkspaces() {
    if (this.workspaces) {
      return this.workspaces;
    }

    const { stdout } = await Execa('yarn', ['workspaces', 'info', '--json'], {
      cwd: this.cwd,
    });

    const { data } = JSON.parse(stdout);
    this.workspaces = JSON.parse(data);

    return this.workspaces;
  }

  async initialize() {
    const workspaces = await this.getWorkspaces();
    await ForEach(workspaces, async ({ location }, name) => {
      this.log(`initialize: iterating over workspace ${name}`);
      await this.linkPackage(location, join(this.cwd, location), []);
    });
  }

  async cleanup() {
    const workspaces = await this.getWorkspaces();
    await ForEach(workspaces, async ({ location }, name) => {
      this.log(`cleanup: iterating over workspace ${name}`);

      const nodeModules = join(this.cwd, location, 'node_modules');
      const [, st] = await Intercept(stat(nodeModules));

      if (!st || !st.isDirectory()) {
        return;
      }

      const files = await readdir(nodeModules, { withFileTypes: true });
      const symlinks = files.filter(file => file.isSymbolicLink());
      const scoped = files.filter(({ name }) => /^@/.test(name));

      const removable = await Reduce(
        scoped,
        async (removable, { name }) => {
          const nNodeModules = join(nodeModules, name);
          const [, st] = await Intercept(stat(nNodeModules));

          if (!st || !st.isDirectory()) {
            return;
          }

          const files = await readdir(nNodeModules, { withFileTypes: true });
          return removable.concat(files.filter(file => file.isSymbolicLink()));
        },
        symlinks,
      );

      await ForEach(removable, async location => Unlink(location));

      const pattern = `${nodeModules}/**/.serverless-workspaces-plugin-copied`;
      await ForEach(
        await Globby([pattern]),
        async file => await remove(dirname(file)),
      );
    });
  }

  async linkPackage(workspace, directory, resolved) {
    const { name, version, dependencies = {} } = require(join(
      directory,
      'package.json',
    ));

    const id = `${name}@${version}`;
    if (resolved.includes(id)) {
      return;
    }

    resolved.push(id);

    await ForEach(dependencies, async (_, name) => {
      const location = Resolve(name, {
        cwd: directory,
      });

      if (!location) {
        return;
      }

      if (join(this.cwd, 'node_modules', name) === location) {
        await Link(location, join(workspace, 'node_modules', name));
      }

      await this.linkPackage(workspace, location, resolved);
    });
  }

  async copyWorkspaces() {
    const workspaces = await this.getWorkspaces();
    await ForEach(workspaces, async ({ location }, name) => {
      this.log(`after:initialize: iterating over workspace ${name}`);

      const { dependencies = {} } = require(join(
        this.cwd,
        location,
        'package.json',
      ));

      const locals = await Filter(
        Object.keys(dependencies).filter(name => Boolean(workspaces[name])),
        async name => {
          const dir = join(location, 'node_modules', name);
          const [, st] = await Intercept(stat(dir));
          return !st;
        },
      );

      await ForEach(locals, async name => {
        const { location: source } = workspaces[name];
        const a = join(this.cwd, source);
        const b = join(this.cwd, location, 'node_modules', name);
        await copy(a, b);
        await ensureFile(join(b, '.serverless-workspaces-plugin-copied'));
      });

      await ForEach(locals, async name => {
        const root = join(
          this.cwd,
          location,
          'node_modules',
          name,
          'node_modules',
        );

        const [, st] = await Intercept(stat(root));
        if (!st) {
          return;
        }

        const modules = await readdir(root, { withFileTypes: true });
        await ForEach(
          modules.filter(file => file.isSymbolicLink()),
          async ({ name }) => Unlink(join(root, name)),
        );
      });
    });
  }
};

const { default: Filter } = require('apr-filter');
const { default: ForEach } = require('apr-for-each');
const Intercept = require('apr-intercept');
const Reduce = require('apr-reduce');
const Execa = require('execa');
const { symlink, unlink, ensureDir, readdir, stat, copy } = require('fs-extra');
const Resolve = require('resolve-pkg');
const { join, dirname, basename } = require('path');

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
    const workspaces = (this.workspaces = JSON.parse(data));
    return workspaces;
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

      const node_modules = join(this.cwd, location, 'node_modules');
      const [, st] = await Intercept(stat(node_modules));

      if (!st || !st.isDirectory()) {
        return;
      }

      const files = await readdir(node_modules, { withFileTypes: true });
      const symlinks = files.filter(file => file.isSymbolicLink());
      const scoped = files.filter(({ name }) => /^\@/.test(name));

      const removable = await Reduce(
        scoped,
        async (removable, { name }) => {
          const n_node_modules = join(node_modules, name);
          const [, st] = await Intercept(stat(n_node_modules));

          if (!st || !st.isDirectory()) {
            return;
          }

          const files = await readdir(n_node_modules, { withFileTypes: true });
          return removable.concat(files.filter(file => file.isSymbolicLink()));
        },
        symlinks,
      );

      await ForEach(removable, async location => Unlink(location));
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

      const pkg = join(location, 'package.json');
      const { dependencies = {} } = require(pkg);

      await ForEach(dependencies, async (_, name) => {
        await this.linkPackage(workspace, dirname(pkg), resolved);
      });
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
      });

      await ForEach(locals, async name => {
        const root = join(
          this.cwd,
          location,
          'node_modules',
          name,
          'node_modules',
        );

        const modules = await readdir(root, { withFileTypes: true });
        await ForEach(
          modules.filter(file => file.isSymbolicLink()),
          async ({ name }) => await Unlink(join(root, name)),
        );
      });
    });
  }
};

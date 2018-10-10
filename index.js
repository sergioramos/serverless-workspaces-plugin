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
      // before doing anything, cleanup
      'package:cleanup': this.cleanup.bind(this),
      // before start packing, create symlinks for dependencies
      'package:initialize': this.initialize.bind(this),
      // after creating symlinks, go over local dependencies and copy them
      // (so that we can remove their symlinks in a non-destructive way)
      'after:package:initialize': this.copyWorkspaces.bind(this),
      // cleanup everything again
      // (so that we can go on with a normal monorepo again)
      'after:package:finalize': this.cleanup.bind(this),
    };
  }

  async getWorkspaces() {
    // workspaces is already calculated and cached
    if (this.workspaces) {
      return this.workspaces;
    }

    // get list of workspaces with location
    const { stdout } = await Execa('yarn', ['workspaces', 'info', '--json'], {
      cwd: this.cwd,
    });

    const { data } = JSON.parse(stdout);
    // cache result
    this.workspaces = JSON.parse(data);

    return this.workspaces;
  }

  async initialize() {
    const workspaces = await this.getWorkspaces();
    await ForEach(workspaces, async ({ location }, name) => {
      this.log(`workspace: initializing ${name}`);
      await this.linkPackage(location, join(this.cwd, location), []);
    });
  }

  async cleanup() {
    const workspaces = await this.getWorkspaces();
    await ForEach(workspaces, async ({ location }, name) => {
      this.log(`workspace: cleaning ${name}`);

      const nodeModules = join(this.cwd, location, 'node_modules');
      const [, st] = await Intercept(stat(nodeModules));

      // if workspace has no dependencies, ignore
      if (!st || !st.isDirectory()) {
        return;
      }

      // get node_modules'
      const files = await readdir(nodeModules, { withFileTypes: true });
      // get node_modules that are symlinks
      const symlinks = files.filter(file => file.isSymbolicLink());
      // get node_modules that are scoped
      const scoped = files.filter(({ name }) => /^@/.test(name));

      // start with the symlinks and go through scoped dependencies
      // for each, get all the files in said folder
      // filter those that aren't symlinks
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

      // remove all the node_modules and scoped node_modules that are symlinks
      await ForEach(removable, async location => Unlink(location));

      // find copied workspaces, and remove them too
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

    // cahce resolved dependency
    resolved.push(id);

    await ForEach(dependencies, async (_, name) => {
      // resolve dependency from where it is depended on
      const location = Resolve(name, {
        cwd: directory,
      });

      // not installed, ignore
      if (!location) {
        return;
      }

      // if dependency is hoisted, link it to the workspace's node_modules
      if (join(this.cwd, 'node_modules', name) === location) {
        await Link(location, join(workspace, 'node_modules', name));
      }

      // iterate over the dependencies of this dependency
      await this.linkPackage(workspace, location, resolved);
    });
  }

  // we copy the local dependencies and don't link,
  // because we want to remove duplicated links
  // let's say that workspaces `a` and `b` depend on each other:
  // `a/node_modules/b` will have the links of `b`'s dependencies and vice-versa
  // if those dependencies are duplicate between local dependencies,
  // they are going to be duplicated in the packge (since it turns symlinks
  // into regular folders)
  async copyWorkspaces() {
    const workspaces = await this.getWorkspaces();
    await ForEach(workspaces, async ({ location }, name) => {
      this.log(`workspace: copying ${name}`);

      const { dependencies = {} } = require(join(
        this.cwd,
        location,
        'package.json',
      ));

      // go over the dependencies of this workspace
      // filter by those that are workspaces
      // and by those that don't exist yet (could be a conflicting version)
      const locals = await Filter(
        Object.keys(dependencies).filter(name => Boolean(workspaces[name])),
        async name => {
          const dir = join(location, 'node_modules', name);
          const [, st] = await Intercept(stat(dir));
          return !st;
        },
      );

      // for each local, copy the workspace from it's original location
      // to the current workspace node_modules'
      // then, create a flag file so that we can detect later which were copied
      // and which were there originally
      await ForEach(locals, async name => {
        const { location: source } = workspaces[name];
        const a = join(this.cwd, source);
        const b = join(this.cwd, location, 'node_modules', name);
        await copy(a, b);
        await ensureFile(join(b, '.serverless-workspaces-plugin-copied'));
      });

      // go over the locals and each node_module that is a symlink, unlink
      // we are sure that that dependency already exists in the workspace
      // because we already linked it before
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

/* eslint-env node */
import "babel-polyfill";
import fs_ from "fs";
import childProcess from "child_process";
import path from "path";

import gulp from "gulp";
import gutil from "gulp-util";
import newer from "gulp-newer";
import rename from "gulp-rename";
import jison from "gulp-jison";
import typedoc from "gulp-typedoc";
import Promise from "bluebird";
import del from "del";
import touch from "touch";
import reduce from "stream-reduce";
import es from "event-stream";
import { ArgumentParser } from "argparse";
import eslint from "gulp-eslint";
import versync from "versync";
import webpack from "webpack";
import sourcemaps from "gulp-sourcemaps";
import tslint from "gulp-tslint";
import ts from "gulp-typescript";
import webpackConfig from "../webpack.config";
import { execFileAsync } from "./util";

const touchAsync = Promise.promisify(touch);
const fs = Promise.promisifyAll(fs_);

//
// This script accepts configuration options from 3 places, in
// decreasing order of precedence:
//
// 1. command line,
// 2. configuration file,
// 3. internal default.
//

// Try to load local configuration options.
let localConfig = {};
try {
  // eslint-disable-next-line global-require, import/no-unresolved
  localConfig = require("./gulp.local");
}
catch (e) {
  if (e.code !== "MODULE_NOT_FOUND") {
    throw e;
  }
}

const parser = new ArgumentParser({ addHelp: true });

// We have this here so that the help message is more useful than
// without. At the same time, this positional argument is not
// *required*.
parser.addArgument(["target"], {
  help: "Target to execute.",
  nargs: "?",
  defaultValue: "default",
});

parser.addArgument(["--doc-private"], {
  help: "document private functions.",
  type: Boolean,
  action: "storeTrue",
  defaultValue: localConfig.doc_private,
});

parser.addArgument(["--no-doc-private"], {
  help: "do not document private functions.",
  type: Boolean,
  action: "storeFalse",
  dest: "doc_private",
  defaultValue: localConfig.doc_private,
});

parser.addArgument(["--mocha-grep"], {
    // We do not have a default for this one.
  help: "A pattern to pass to mocha to select tests.",
});

parser.addArgument(["--rst2html"], {
  help: "The path of the rst2html executable.",
  defaultValue: localConfig.rst2html || "rst2html",
});

const options = parser.parseArgs(process.argv.slice(2));

gulp.task("lint", ["tslint", "eslint"]);

gulp.task("eslint",
          // The TypeScript code must have been compiled, otherwise we get
          // reference errors.
          ["tsc"],
          () =>
          gulp.src([
            "*.js",
            "bin/**/*.js",
            "lib/**/*.js",
            "gulptasks/**/*.js",
            "test/**/*.js",
            "!test/salve-convert/**/*.js",
            "misc/**/*.js",
            "!test/**/simplified-rng*.js",
          ])
          .pipe(eslint())
          .pipe(eslint.format())
          .pipe(eslint.failAfterError()));

gulp.task("tslint", () =>
          gulp.src("lib/**/*.ts")
          .pipe(tslint({
            formatter: "verbose",
          }))
          .pipe(tslint.report()));

gulp.task("copy-src", () => {
  const dest = "build/dist/";
  return gulp.src([
    "package.json",
    "bin/*",
    "lib/**/*.d.ts",
    "lib/**/*.xsl",
  ], { base: "." })
    .pipe(newer(dest))
    .pipe(gulp.dest(dest));
});

gulp.task("copy-readme", () => {
  const dest = "build/dist/";
  return gulp.src("NPM_README.md")
    .pipe(rename("README.md"))
  // Yep, newer has to be after the rename. The rename is done in memory and we
  // want to have it done *before* the test so that the test tests against the
  // correct file in the filesystem.
    .pipe(newer(dest))
    .pipe(gulp.dest(dest));
});

gulp.task("jison", () => {
  const dest = "build/dist/lib/salve/datatypes";
  return gulp.src("lib/salve/datatypes/regexp.jison")
    .pipe(newer(`${dest}/regexp.js`))
    .pipe(jison({
      moduleType: "commonjs",
      // Override the default main created by Jison. This module cannot ever be
      // used as a main script. And the default that Jison uses does
      // `require("fs")` which causes problems.
      moduleMain: function main() {
        throw new Error("this module cannot be used as main");
      },
    }))
    .pipe(gulp.dest(dest));
});

gulp.task("default", ["webpack"]);

gulp.task("copy", ["copy-src", "copy-readme"], () =>
          fs.writeFileAsync("build/dist/.npmignore", "bin/parse.js"));

const project = ts.createProject("tsconfig.json");
gulp.task("tsc", () => {
  // The .once nonsense is to work around a gulp-typescript bug
  //
  // See: https://github.com/ivogabe/gulp-typescript/issues/295
  //
  // For the fix see:
  // https://github.com/ivogabe/gulp-typescript/issues/295#issuecomment-197299175
  //
  const result = project.src()
          .pipe(sourcemaps.init({ loadMaps: true }))
          .pipe(project())
          .once("error", function onError() {
            this.once("finish", () => {
              process.exit(1);
            });
          });

  const dest = "build/dist/lib";
  return es.merge(result.js
                  .pipe(sourcemaps.write("."))
                  .pipe(gulp.dest(dest)),
                  result.dts.pipe(gulp.dest(dest)));
});


gulp.task("webpack", ["tsc", "copy", "jison"], (callback) => {
  webpack(webpackConfig, (err, stats) => {
    if (err) {
      throw new gutil.PluginError("webpack", err);
    }

    gutil.log("[webpack]", stats.toString({ colors: true }));

    callback();
  });
});

let packname;

gulp.task("pack", ["default"],
          () => execFileAsync("npm", ["pack", "dist"], { cwd: "build" })
          .then((_packname) => {
            packname = _packname.trim();
          }));

gulp.task("install_test", ["pack"], Promise.coroutine(function *install() {
  const testDir = "build/install_dir";
  yield del(testDir);
  yield fs.mkdirAsync(testDir);
  yield fs.mkdirAsync(path.join(testDir, "node_modules"));
  yield execFileAsync("npm", ["install", `../${packname}`, "sax", "@types/sax"],
                      { cwd: testDir });
  let module = yield fs.readFileAsync("lib/salve/parse.ts");
  module = module.toString();
  module = module.replace("./validate", "salve");
  yield fs.writeFileAsync(path.join(testDir, "parse.ts"), module);
  yield execFileAsync("../../node_modules/.bin/tsc", ["parse.ts"],
                      { cwd: testDir });
  yield del(testDir);
}));

gulp.task("publish", ["install_test"],
          () => execFileAsync("npm", ["publish", packname], { cwd: "build" }));

gulp.task("typedoc", ["lint"], (callback) => {
  const stamp = "build/api.stamp";

  gulp
    .src(["lib/**/*.ts"])
    .pipe(newer(stamp))
    .pipe(reduce((acc, data) => {
      acc.push(data);
      return acc;
    }, []))
    .on("data", (files) => {
      if (files.length === 0) {
        gutil.log("No change, skipping typedoc.");
        callback();
        return;
      }

      const tsoptions = JSON.parse(fs.readFileSync("tsconfig.json"))
              .compilerOptions;
      const version = JSON.parse(fs.readFileSync("package.json")).version;
      Object.assign(tsoptions, {
        out: `./build/api/salve/${version}`,
        name: "salve",
        readme: "doc/api_intro.md",
        ignoreCompilerErrors: false,
        version: true,
        excludePrivate: !options.doc_private,
      });

      // These are not supported by typedoc.
      delete tsoptions.noImplicitThis;
      delete tsoptions.declaration;
      delete tsoptions.sourceMap;
      delete tsoptions.strictNullChecks;

      gulp
        .src(["lib/**/*.ts"])
        .pipe(typedoc(tsoptions))
        .on("end", () => {
          touchAsync(stamp).asCallback(callback);
        });
    });
});

gulp.task("readme", () => {
  // The following code works fine only with one source and one
  // destination. We're pretty much using gulp in a non-gulp way but this avoids
  // having to code the logic of newer() ourselves. YMMV as to whether this is
  // better.
  const dest = "README.html";
  const src = "README.rst";
  return gulp.src(src, { read: false })
    .pipe(newer(dest))
    .pipe(es.map((file, callback) =>
                 childProcess.execFile(options.rst2html, [src, dest],
                                       () => callback())));
});

gulp.task("doc", ["typedoc", "readme"]);

gulp.task("gh-pages-build", ["typedoc"], () => {
  const dest = "gh-pages-build";
  return gulp.src("**/*", { cwd: "build/api/" })
    .pipe(newer(dest))
    .pipe(gulp.dest(dest));
});

gulp.task("versync", () => versync.run({
  verify: true,
  onMessage: gutil.log,
}));

//
// Ideally we'd be using gulp-mocha but there are issues with running
// Mocha as part of the same process which runs gulp. So we don't.
//
// import mocha from "gulp-mocha";
//
// gulp.task("mocha", () => gulp.src("test/*.js", { read: false })
//           .pipe(mocha({
//               reporter: "dot",
//               grep: options.mocha_grep
//           })));

gulp.task("mocha", ["default"], (callback) => {
  const child = childProcess.spawn(
    "./node_modules/.bin/mocha",
    options.mocha_grep ? ["--grep", options.mocha_grep] : [],
    { stdio: "inherit" });

  child.on("exit", (code, signal) => {
    if (code) {
      callback(new Error(`child terminated with code: ${code}`));
      return;
    }

    if (signal) {
      callback(new Error(`child terminated with signal: ${signal}`));
      return;
    }

    callback();
  });
});

gulp.task("test", ["default", "lint", "versync", "mocha"]);

gulp.task("clean", () => del(["build", "gh-pages-build"]));
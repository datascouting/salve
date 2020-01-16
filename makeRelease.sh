#!/bin/bash

VERSION=$1

npm install
./node_modules/gulp/bin/gulp.js test
./node_modules/gulp/bin/gulp.js install_test
./node_modules/gulp/bin/gulp.js

cd ./build/dist/
tar -czvf ./../../salve-${VERSION}.tar.gz ./

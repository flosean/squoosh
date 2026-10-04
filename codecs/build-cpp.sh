#!/bin/sh -e
EMSDK_VERSION=${EMSDK_VERSION:-2.0.34}
image="squoosh-cpp-$EMSDK_VERSION"
docker build --build-arg EMSDK_VERSION="$EMSDK_VERSION" -t "$image" - < ../cpp.Dockerfile
docker run -it --rm -v "$PWD:/src" "$image" "$@"

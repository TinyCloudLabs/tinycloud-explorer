# TinyCloud SDK services test package

This directory contains the published `@tinycloud/sdk-services-test@13.0.0`
package. Its runtime and type declarations are unmodified.

The published package currently declares its `@tinycloud/sdk-services` peer and
development dependency as `workspace:*`, which package managers cannot resolve
outside the SDK monorepo. The vendored `package.json` changes those ranges to
`^2.8.0`.

The published ESM build also omits `.js` from its relative imports. The vendored
runtime adds those extensions so it resolves in standards-compliant ESM tools.

Remove this directory and use the registry package directly once its published
peer dependency is consumable.

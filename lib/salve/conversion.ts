/**
 * This module contains utilities used for converting Relax NG files to the
 * format required by salve.
 *
 * @author Louis-Dominique Dubeau
 * @license MPL 2.0
 * @copyright Mangalam Research Center for Buddhist Languages
 *
 */
"use strict";

export { ConversionResult, convertRNGToPattern } from "./conversion/convert";
export { Element, parseSimplifiedSchema,
         Text } from "./conversion/parser";
export { makeResourceLoader, Resource,
         ResourceLoader } from "./conversion/resource-loader";
export { serialize } from "./conversion/serializer";
export { getAvailableSimplifiers, makeSimplifier, ManifestEntry,
         SimplificationResult } from "./conversion/schema-simplification";
export { getAvailableValidators, makeValidator, SchemaValidationError,
         SchemaValidationResult } from "./conversion/schema-validation";

//  LocalWords:  NG MPL

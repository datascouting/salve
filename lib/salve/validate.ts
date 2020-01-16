/**
 * RNG-based validator.
 *
 * @author Louis-Dominique Dubeau
 * @license MPL 2.0
 * @copyright Mangalam Research Center for Buddhist Languages
 */

export const version: string = "10.0.0-ds";

export { eventsToTreeString, EventSet, Grammar, GrammarWalker,
         BasePattern, FireEventResult, EndResult } from "./patterns";

export { ConversionResult, convertRNGToPattern, makeResourceLoader,
         ManifestEntry, Resource, ResourceLoader } from "./conversion";

export { writeTreeToJSON } from "./json-format/write";
export { readTreeFromJSON } from "./json-format/read";

export { EName }  from "./ename";

export * from "./events";

export { AttributeNameError, AttributeValueError, ChoiceError,
         ElementNameError, ValidationError } from "./errors";

export { DefaultNameResolver } from "./default_name_resolver";
export { NameResolver } from "./name_resolver";

export { Base as BaseName, ConcreteName, Name, NameChoice, NsName,
         AnyName } from "./name_patterns";

//  LocalWords:  rng Mangalam Dubeau MPL RNG constructTree validator

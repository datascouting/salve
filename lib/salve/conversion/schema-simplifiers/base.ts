/**
 * A base class providing some functionality that most simplifiers need.
 *
 * @author Louis-Dominique Dubeau
 * @license MPL 2.0
 * @copyright Mangalam Research Center for Buddhist Languages
 */
import { SchemaSimplifier, SchemaSimplifierCtor, SchemaSimplifierOptions,
         SimplificationResult } from "../schema-simplification";

export abstract class BaseSimplifier implements SchemaSimplifier {
  constructor(protected readonly options: SchemaSimplifierOptions) {
    if (options.timing) {
      options.verbose = true;
    }
    if (options.validate &&
        !(this.constructor as SchemaSimplifierCtor).validates) {
      throw new Error(
        "requested validation on a simplifier that does not validate");
    }

    if (options.createManifest &&
        !(this.constructor as SchemaSimplifierCtor).createsManifest) {
      throw new Error(
        "requested a manifest on a simplifier that does not create manifests");
    }
  }

  abstract simplify(schemaPath: string | URL): Promise<SimplificationResult>;
}

import type { Algorithm } from "../dist/contract.js";
import { parseParams } from "../dist/params.js";
import { orderOf, parseSelector, publicStepOf } from "../dist/selector.js";

/** One step of a system, the way the resolver produces it. */
export function step(
  algorithm: Algorithm,
  writtenParams: Record<string, unknown>,
  selector: string,
) {
  const params = parseParams(algorithm, writtenParams).values;
  const shape = algorithm.selector(params);
  const parsed = parseSelector(algorithm.name, shape, selector);
  return {
    color: algorithm.resolve(parsed.values, params),
    publicStep: publicStepOf(parsed),
    order: orderOf(shape, parsed),
  };
}

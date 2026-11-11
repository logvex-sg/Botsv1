/**
 * Crafting engine: material tracking and availability for crafting and processing.
 *
 * This engine is honest about what the Host can and cannot do. It tracks the materials a recipe
 * needs against a worker's reported inventory and says whether they are present. It does *not*
 * claim to craft anything: the Host cannot observe a crafting result it did not cause, and the
 * brief is explicit that unsupported machines must not be faked. What it provides is the
 * availability check a supervised crafting workflow needs before a worker is asked to run a
 * crafting command.
 *
 * Pure: unit-testable.
 */
import type { WorkerItem } from '../../../shared/workers';
import { countIn } from '../inventory-engine';

/** One ingredient a recipe needs. */
export interface RecipeIngredient {
  query: string;
  label: string;
  count: number;
}

/** A recipe the operator defined: a name and the ingredients it consumes. */
export interface Recipe {
  id: string;
  name: string;
  ingredients: RecipeIngredient[];
  /** How many of the output a single craft produces. */
  outputCount: number;
  outputLabel: string;
}

/** Whether one ingredient is available, and by how much it falls short. */
export interface IngredientStatus {
  query: string;
  label: string;
  required: number;
  found: number;
  missing: number;
}

export interface CraftabilityReport {
  recipeId: string;
  recipeName: string;
  craftable: boolean;
  /** How many times the recipe could be crafted from the reported inventory. */
  times: number;
  ingredients: IngredientStatus[];
  reasons: string[];
}

/**
 * How many times a recipe can be crafted from a reported inventory.
 *
 * The answer is the minimum, across ingredients, of floor(found / required). A recipe with no
 * ingredients is reported as 0 times, not infinite, so a malformed definition cannot look craftable.
 */
export function craftableTimes(recipe: Recipe, carried: readonly WorkerItem[]): number {
  if (recipe.ingredients.length === 0) return 0;
  let times = Number.POSITIVE_INFINITY;
  for (const ingredient of recipe.ingredients) {
    if (ingredient.count <= 0) return 0;
    times = Math.min(times, Math.floor(countIn(carried, ingredient.query) / ingredient.count));
  }
  return Number.isFinite(times) ? times : 0;
}

/** A full availability report for a recipe against a reported inventory. */
export function assess(recipe: Recipe, carried: readonly WorkerItem[]): CraftabilityReport {
  const ingredients = recipe.ingredients.map((ingredient) => {
    const found = countIn(carried, ingredient.query);
    return {
      query: ingredient.query,
      label: ingredient.label || ingredient.query,
      required: ingredient.count,
      found,
      missing: Math.max(0, ingredient.count - found),
    };
  });
  const missing = ingredients.filter((ingredient) => ingredient.missing > 0);
  const times = craftableTimes(recipe, carried);
  return {
    recipeId: recipe.id,
    recipeName: recipe.name,
    craftable: missing.length === 0,
    times,
    ingredients,
    reasons: missing.length === 0 ? [] : [`missing ${missing.map((ingredient) => `${ingredient.missing}x ${ingredient.label}`).join(', ')}`],
  };
}

/** Smelting fuel items and their burn counts, for a fuel-stock estimate. */
const FUEL_BURN = new Map<string, number>([
  ['minecraft:coal', 8],
  ['minecraft:charcoal', 8],
  ['minecraft:coal_block', 80],
  ['minecraft:blaze_rod', 12],
  ['minecraft:oak_planks', 1.5],
  ['minecraft:stick', 0.5],
  ['minecraft:lava_bucket', 100],
  ['minecraft:oak_log', 1.5],
  ['minecraft:oak_sapling', 0.5],
]);

/** Estimates how many smelts a reported inventory's fuel can support. */
export function fuelCapacity(carried: readonly WorkerItem[]): { smelts: number; items: { id: string; count: number; each: number }[] } {
  const items: { id: string; count: number; each: number }[] = [];
  let smelts = 0;
  for (const item of carried) {
    const burn = FUEL_BURN.get(item.id.toLowerCase());
    if (burn === undefined) continue;
    const total = Math.floor(burn * item.count);
    smelts += total;
    items.push({ id: item.id, count: item.count, each: burn });
  }
  return { smelts, items };
}

/** A smelting queue entry: an input to smelt and how many. */
export interface SmeltEntry {
  query: string;
  label: string;
  count: number;
}

/**
 * Plans a smelting queue from a list of desired inputs.
 *
 * The plan reports, for each entry, how many can actually be smelted given the available fuel and
 * the available input, and what is short. It never claims the smelting happened.
 */
export function planSmelting(
  inputs: readonly SmeltEntry[],
  carried: readonly WorkerItem[],
): { queue: { query: string; label: string; smeltable: number; shortInput: number }[]; fuel: { smelts: number; items: { id: string; count: number; each: number }[] }; fuelShortfall: number } {
  const fuel = fuelCapacity(carried);
  let remainingFuel = fuel.smelts;
  const queue: { query: string; label: string; smeltable: number; shortInput: number }[] = [];
  for (const entry of inputs) {
    const available = countIn(carried, entry.query);
    const smeltable = Math.max(0, Math.min(entry.count, available, remainingFuel));
    remainingFuel -= smeltable;
    queue.push({
      query: entry.query,
      label: entry.label || entry.query,
      smeltable,
      shortInput: Math.max(0, Math.min(entry.count, available) - smeltable),
    });
  }
  const wanted = inputs.reduce((sum, entry) => sum + entry.count, 0);
  return { queue, fuel, fuelShortfall: Math.max(0, wanted - fuel.smelts) };
}

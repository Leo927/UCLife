
/**
 * @param {FC.HumanState} actor
 * @returns {boolean}
 */
globalThis.burstCheck = function(actor) {
	return !!actor.burst;
};

/**
 * Marks the actor as ready to burst. Bursting will happen during the end of week
 * @param {FC.HumanState} actor
 */
globalThis.burst = function(actor) {
	actor.burst = 1;
};

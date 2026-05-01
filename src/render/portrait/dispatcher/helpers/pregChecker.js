
/**
 * @param {FC.HumanState} actor
 * @returns {boolean}
 */
globalThis.isInLabor = function(actor) {
	return !!actor.labor;
};

/**
 * @param {FC.HumanState} actor
 */
globalThis.startLabor = function(actor) {
	actor.labor = 1;
};

/**
 * @param {FC.HumanState} actor
 * @returns {boolean}
 */
globalThis.isInduced = function(actor) {
	return !!actor.induce;
};

/**
 * @param {FC.HumanState} actor
 */
globalThis.induce = function(actor) {
	startLabor(actor);
	actor.induce = 1;
};

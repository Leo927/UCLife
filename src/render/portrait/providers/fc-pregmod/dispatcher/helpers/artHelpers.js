globalThis.extractColor = (function() {
	/*
	these are color names known and used in FreeCities
	attributed color names are at the front of the array
	*/
	const FCnames = new Map([
		["amber", "#ffbf00"],
		["auburn", "#a53f2a"],
		["black", "#171717"],
		["blazing red", "#E00E2B"],
		["blonde", "#F4F1A3"],
		["blue", "#4685C5"],
		["blue-violet", "#8790B7"],
		["brown", "#7e543e"],
		["burgundy", "#34000d"],
		["chestnut", "#663622"],
		["chocolate", "#402215"],
		["copper", "#e29c58"],
		["dark blue", "#000034"],
		["dark brown", "#4b3225"],
		["dark orchid", "#9932CC"],
		["deep red", "#6D1318"],
		["ginger", "#da822d"],
		["golden", "#ffd700"],
		["green", "#5FBA46"],
		["green-yellow", "#ADFF2F"],
		["grey", "#8d8d8d"],
		["hazel", "#8d6f1f"],
		["jet black", "#060606"],
		["light olive", "#806b00"],
		["neon blue", "#0e85fd"],
		["neon green", "#25d12b"],
		["neon pink", "#fc61cd"],
		["pale-grey", "#b3b3b3"],
		["pink", "#D18CBC"],
		["platinum blonde", "#fcf3c1"],
		["purple", "#800080"],
		["red", "#BB2027"],
		["sea green", "#2E8B57"],
		["silver", "#d9d9d9"],
		["strawberry-blonde", "#e5a88c"],
		["amaranth", "#E52B50"],
		["amethyst", "#9966CC"],
		["citrine", "#e4d00a"],
		["emerald", "#50C878"],
		["jade", "#00a86b"],
		["platinum", "#e5e4e2"],
		["onyx", "#0f0f0f"],
		["ruby", "#cc1057"],
		["sapphire", "#0f52ba"],
		/* these are not actually FreeCities canon, but like to appear in custom descriptions */
		["brunette", "#6d4936"],
		["dark", "#463325"],

		/* these are HTML color names supported by most browsers */
		["aliceblue", "#f0f8ff"],
		["antiquewhite", "#faebd7"],
		["aqua", "#00ffff"],
		["aquamarine", "#7fffd4"],
		["azure", "#f0ffff"],
		["beige", "#f5f5dc"],
		["bisque", "#ffe4c4"],
		["blanchedalmond", "#ffebcd"],
		["blueviolet", "#8a2be2"],
		["burlywood", "#deb887"],
		["cadetblue", "#5f9ea0"],
		["chartreuse", "#7fff00"],
		["coral", "#ff7f50"],
		["cornflowerblue", "#6495ed"],
		["cornsilk", "#fff8dc"],
		["crimson", "#dc143c"],
		["cyan", "#00ffff"],
		["darkblue", "#00008b"],
		["darkcyan", "#008b8b"],
		["darkgoldenrod", "#b8860b"],
		["darkgray", "#a9a9a9"],
		["darkgreen", "#006400"],
		["darkkhaki", "#bdb76b"],
		["darkmagenta", "#8b008b"],
		["darkolivegreen", "#556b2f"],
		["darkorange", "#ff8c00"],
		["darkorchid", "#9932cc"],
		["darkred", "#8b0000"],
		["darksalmon", "#e9967a"],
		["darkseagreen", "#8fbc8f"],
		["darkslateblue", "#483d8b"],
		["darkslategray", "#2f4f4f"],
		["darkturquoise", "#00ced1"],
		["darkviolet", "#9400d3"],
		["deeppink", "#ff1493"],
		["deepskyblue", "#00bfff"],
		["dimgray", "#696969"],
		["dodgerblue", "#1e90ff"],
		["firebrick", "#b22222"],
		["floralwhite", "#fffaf0"],
		["forestgreen", "#228b22"],
		["fuchsia", "#ff00ff"],
		["gainsboro", "#dcdcdc"],
		["ghostwhite", "#f8f8ff"],
		["gold", "#ffd700"],
		["goldenrod", "#daa520"],
		["gray", "#808080"],
		["greenyellow", "#adff2f"],
		["honeydew", "#f0fff0"],
		["hotpink", "#ff69b4"],
		["indianred ", "#cd5c5c"],
		["indigo", "#4b0082"],
		["ivory", "#fffff0"],
		["khaki", "#f0e68c"],
		["lavender", "#e6e6fa"],
		["lavenderblush", "#fff0f5"],
		["lawngreen", "#7cfc00"],
		["lemonchiffon", "#fffacd"],
		["lightblue", "#add8e6"],
		["lightcoral", "#f08080"],
		["lightcyan", "#e0ffff"],
		["lightgoldenrodyellow", "#fafad2"],
		["lightgrey", "#d3d3d3"],
		["lightgreen", "#90ee90"],
		["lightpink", "#ffb6c1"],
		["lightsalmon", "#ffa07a"],
		["lightseagreen", "#20b2aa"],
		["lightskyblue", "#87cefa"],
		["lightslategray", "#778899"],
		["lightsteelblue", "#b0c4de"],
		["lightyellow", "#ffffe0"],
		["lime", "#00ff00"],
		["limegreen", "#32cd32"],
		["linen", "#faf0e6"],
		["magenta", "#ff00ff"],
		["maroon", "#800000"],
		["mediumaquamarine", "#66cdaa"],
		["mediumblue", "#0000cd"],
		["mediumorchid", "#ba55d3"],
		["mediumpurple", "#9370d8"],
		["mediumseagreen", "#3cb371"],
		["mediumslateblue", "#7b68ee"],
		["mediumspringgreen", "#00fa9a"],
		["mediumturquoise", "#48d1cc"],
		["mediumvioletred", "#c71585"],
		["midnightblue", "#191970"],
		["mintcream", "#f5fffa"],
		["mistyrose", "#ffe4e1"],
		["moccasin", "#ffe4b5"],
		["navajowhite", "#ffdead"],
		["navy", "#000080"],
		["oldlace", "#fdf5e6"],
		["olive", "#808000"],
		["olivedrab", "#6b8e23"],
		["orange", "#ffa500"],
		["orangered", "#ff4500"],
		["orchid", "#da70d6"],
		["palegoldenrod", "#eee8aa"],
		["palegreen", "#98fb98"],
		["paleturquoise", "#afeeee"],
		["palevioletred", "#d87093"],
		["papayawhip", "#ffefd5"],
		["peachpuff", "#ffdab9"],
		["peru", "#cd853f"],
		["plum", "#dda0dd"],
		["powderblue", "#b0e0e6"],
		["rebeccapurple", "#663399"],
		["rosybrown", "#bc8f8f"],
		["royalblue", "#4169e1"],
		["saddlebrown", "#8b4513"],
		["salmon", "#fa8072"],
		["sandybrown", "#f4a460"],
		["seagreen", "#2e8b57"],
		["seashell", "#fff5ee"],
		["sienna", "#a0522d"],
		["sky-blue", "#87ceeb"],
		["slateblue", "#6a5acd"],
		["slategray", "#708090"],
		["snow", "#fffafa"],
		["springgreen", "#00ff7f"],
		["steelblue", "#4682b4"],
		["tan", "#d2b48c"],
		["teal", "#008080"],
		["thistle", "#d8bfd8"],
		["tomato", "#ff6347"],
		["turquoise", "#40e0d0"],
		["violet", "#ee82ee"],
		["wheat", "#f5deb3"],
		["white", "#ffffff"],
		["whitesmoke", "#f5f5f5"],
		["yellow", "#ffff00"],
		["yellowgreen", "#9acd32"]
	]);

	/* these are HTML color names supported by most browsers */
	const HTMLstandardColors = ["aliceblue", "antiquewhite", "aqua", "aquamarine", "azure", "beige", "bisque", "black", "blanchedalmond", "blue", "blueviolet", "brown", "burlywood", "cadetblue", "chartreuse", "chocolate", "coral", "cornflowerblue", "cornsilk", "crimson", "cyan", "darkblue", "darkcyan", "darkgoldenrod", "darkgray", "darkgrey", "darkgreen", "darkkhaki", "darkmagenta", "darkolivegreen", "darkorange", "darkorchid", "darkred", "darksalmon", "darkseagreen", "darkslateblue", "darkslategray", "darkslategrey", "darkturquoise", "darkviolet", "deeppink", "deepskyblue", "dimgray", "dimgrey", "dodgerblue", "firebrick", "floralwhite", "forestgreen", "fuchsia", "gainsboro", "ghostwhite", "gold", "goldenrod", "gray", "grey", "green", "greenyellow", "honeydew", "hotpink", "indianred", "indigo", "ivory", "khaki", "lavender", "lavenderblush", "lawngreen", "lemonchiffon", "lightblue", "lightcoral", "lightcyan", "lightgoldenrodyellow", "lightgray", "lightgrey", "lightgreen", "lightpink", "lightsalmon", "lightseagreen", "lightskyblue", "lightslategray", "lightslategrey", "lightsteelblue", "lightyellow", "lime", "limegreen", "linen", "magenta", "maroon", "mediumaquamarine", "mediumblue", "mediumorchid", "mediumpurple", "mediumseagreen", "mediumslateblue", "mediumspringgreen", "mediumturquoise", "mediumvioletred", "midnightblue", "mintcream", "mistyrose", "moccasin", "navajowhite", "navy", "oldlace", "olive", "olivedrab", "orange", "orangered", "orchid", "palegoldenrod", "palegreen", "paleturquoise", "palevioletred", "papayawhip", "peachpuff", "peru", "pink", "plum", "powderblue", "purple", "rebeccapurple", "red", "rosybrown", "royalblue", "saddlebrown", "salmon", "sandybrown", "seagreen", "seashell", "sienna", "silver", "skyblue", "slateblue", "slategray", "slategrey", "snow", "springgreen", "steelblue", "tan", "teal", "thistle", "tomato", "turquoise", "violet", "wheat", "white", "whitesmoke", "yellow", "yellowgreen"];
	const hexColor = /^#([0-9a-f]{3}){1,2}$/;

	/** This takes a textual hair color description and tries to guess the appropriate HTML compliant color code.
	 * This code's working is described to the user in the Encyclopedia, chapter "Lore", section "Dyes".
	 * @param {string} color should be a color name, but can also be a string describing hair color.
	 * @param {any} [eyes] can be nearly anything, it only indicates that the function is being used for eye color instead of hair color.
	 * @returns {string} color code - hex or html standard string suitable for use in styles
	 */
	function mapColor(color, eyes) {
		color = color.toLowerCase(); /* normalization: lowercase color name */
		let colorNoSpaces = color.replace(/\s+/g, ''); /* remove all spaces from description */
		let colorCode = FCnames.get(color); /* look up in FreeCities color names */
		if (!colorCode) { /* not a FreeCities color name*/
			colorCode = FCnames.get(colorNoSpaces); /* look up again without spaces */
		}
		if (!colorCode) { /* still not a FreeCities color name*/
			if (HTMLstandardColors.includes(color) || color.match(hexColor) !== null) {
				colorCode = color; /* is a HTML color name or value, use it directly */
			} else {
				/*
				is not even a HTML color name. color probably is a description.
				look for anything resembling a valid color name within the description.
				*/
				let FCkeys = Array.from(FCnames.keys());
				let colorCodes = [
					FCnames.get(FCkeys.find(function(e) {
						return color.startsWith(e);
					})),
					HTMLstandardColors.find(function(e) {
						return colorNoSpaces.startsWith(e);
					}),
					FCnames.get(FCkeys.find(function(e) {
						return color.includes(e);
					})),
					HTMLstandardColors.find(function(e) {
						return colorNoSpaces.includes(e);
					})
				];
				colorCode = colorCodes.find(function(e) {
					return e;
				}); /* picks the first successful guess */
			}
		}
		if (!colorCode) {
			console.log("Art Color Tools JS: Unable to determine HTML compliant color code for color string '" + color + "'.");
			if (eyes) {
				colorCode = "#89b7ff";
			} else {
				colorCode = "fuchsia"; /* use fuchsia as error marker */
			}
		}
		return colorCode;
	}

	return mapColor;
})();

globalThis.clothing2artSuffix = function(v) {
	if (v === "restrictive latex") {
		v = "latex";
	} /* universal "special case": latex art is actually "restrictive latex" TODO: align name in vector source */
	return v.replace(/^a[n]? /, "") /* remove "a" and "an" from the beginning*/
		.replace(/ ?(outfit|clothing) ?/, "") /* remove "outfit" and "clothing" (redundant) */
		.replace("-", "") /* remove minus character */
		.replace(/\w\S*/g,
			function(txt) {
				return txt.charAt(0).toUpperCase() +
					txt.substr(1).toLowerCase();
			}
		) /* CamelCase by whitespace */
		.replace(/\W/g, ""); /* remove remaining whitespace */
};

/**
 * @param {FC.SlaveState} artSlave
 * @returns { {skinColor: string, areolaColor: string, labiaColor: string, lipsColor: string} } HTML color codes for slave bits
 */
globalThis.skinColorCatcher = function(artSlave) {
	let colorSlave = {
		skinColor: "#e8b693",
		areolaColor: "#d76b93",
		labiaColor: "#d76b93",
		lipsColor: ""
	};
	switch (artSlave.skin) {
		case "camouflage patterned":
			colorSlave.skinColor = "#78875a";
			colorSlave.areolaColor = "#939F7A";
			colorSlave.labiaColor = "#F977A3";
			colorSlave.lipsColor = "#708050";
			break;
		case "dyed red":
			colorSlave.skinColor = "#bc4949";
			colorSlave.areolaColor = "#C96D6D";
			colorSlave.labiaColor = "#F977A3";
			colorSlave.lipsColor = "#b04040";
			break;
		case "dyed purple":
			colorSlave.skinColor = "#7a2391";
			colorSlave.areolaColor = "#C96D6D";
			colorSlave.labiaColor = "#F977A3";
			colorSlave.lipsColor = "#b04040";
			break;
		case "dyed green":
			colorSlave.skinColor = "#A6C373";
			colorSlave.areolaColor = "#B7CF8F";
			colorSlave.labiaColor = "#F977A3";
			colorSlave.lipsColor = "#A0C070";
			break;
		case "dyed blue":
			colorSlave.skinColor = "#5b8eb7";
			colorSlave.areolaColor = "#7BA4C5";
			colorSlave.labiaColor = "#F977A3";
			colorSlave.lipsColor = "#5080b0";
			break;
		case "dyed pink":
			colorSlave.skinColor = "#fe62b0";
			colorSlave.areolaColor = "#fc45a1";
			colorSlave.labiaColor = "#fba2c0";
			colorSlave.lipsColor = "#ff0000";
			break;
		case "dyed gray":
			colorSlave.skinColor = "#bdbdbd";
			colorSlave.areolaColor = "#666666";
			colorSlave.labiaColor = "#8C8C8C";
			colorSlave.lipsColor = "#171717";
			break;
		case "dyed white":
			colorSlave.skinColor = "#FFFFFF";
			colorSlave.areolaColor = "#CCCCCC";
			colorSlave.labiaColor = "#CCCCCC";
			break;
		case "clown":
			colorSlave.skinColor = "#FFFFFF";
			colorSlave.areolaColor = "#CCCCCC";
			colorSlave.labiaColor = "#CCCCCC";
			colorSlave.lipsColor = "#ff0000";
			break;
		case "dyed black":
			colorSlave.skinColor = "#1c1c1c";
			colorSlave.areolaColor = "#161415";
			colorSlave.labiaColor = "#161415";
			break;
		case "tiger striped":
			colorSlave.skinColor = "#e2d75d";
			colorSlave.areolaColor = "#E7DF7D";
			colorSlave.labiaColor = "#F977A3";
			colorSlave.lipsColor = "#e0d050";
			break;
		default: /* natural colors */
			switch (artSlave.race) {
				case "white":
					switch (artSlave.skin) {
						case "pure white":
						case "ivory":
						case "white":
							colorSlave.skinColor = "#F4EAF0";
							colorSlave.areolaColor = "#FCCCDC";
							colorSlave.labiaColor = "#F977A3";
							break;
						case "extremely pale":
						case "very pale":
							colorSlave.skinColor = "#F4EAF0";
							colorSlave.areolaColor = "#FCCCDC";
							colorSlave.labiaColor = "#F977A3";
							colorSlave.lipsColor = "#ffb9ca";
							break;
						case "pale":
							colorSlave.skinColor = "#F5E1DF";
							colorSlave.areolaColor = "#EFBFCA";
							colorSlave.labiaColor = "#F977A3";
							colorSlave.lipsColor = "#ffb9ca";
							break;
						case "extremely fair":
							colorSlave.skinColor = "#F5E1DF";
							colorSlave.areolaColor = "#EFBFCA";
							colorSlave.labiaColor = "#F977A3";
							break;
						case "very fair":
							colorSlave.skinColor = "#F5D5C9";
							colorSlave.areolaColor = "#E2B4B9";
							colorSlave.labiaColor = "#F977A3";
							break;
						case "fair":
							colorSlave.skinColor = "#F5D5C9";
							colorSlave.areolaColor = "#E2B4B9";
							colorSlave.labiaColor = "#F977A3";
							colorSlave.lipsColor = "#ce6876";
							break;
						case "light":
							colorSlave.skinColor = "#F4C9AA";
							colorSlave.areolaColor = "#F19795";
							colorSlave.labiaColor = "#F977A3";
							colorSlave.lipsColor = "#ce6876";
							break;
						case "light olive":
							colorSlave.skinColor = "#E1B585";
							colorSlave.areolaColor = "#C39696";
							colorSlave.labiaColor = "#F977A3";
							break;
						case "sun tanned":
						case "spray tanned":
						case "tan":
							colorSlave.skinColor = "#E1B585";
							colorSlave.areolaColor = "#C39696";
							colorSlave.labiaColor = "#F977A3";
							colorSlave.lipsColor = "#c1a785";
							break;
						case "olive":
							colorSlave.skinColor = "#D58E5F";
							colorSlave.areolaColor = "#B17777";
							colorSlave.labiaColor = "#F977A3";
							colorSlave.lipsColor = "#9e4c44";
							break;
						case "bronze":
							colorSlave.skinColor = "#D58E5F";
							colorSlave.areolaColor = "#B17777";
							colorSlave.labiaColor = "#F977A3";
							break;
						case "dark olive":
							colorSlave.skinColor = "#A2805C";
							colorSlave.areolaColor = "#8E6454";
							colorSlave.labiaColor = "#F977A3";
							break;
						case "dark":
						case "light beige":
							colorSlave.skinColor = "#825633";
							colorSlave.areolaColor = "#734B2F";
							colorSlave.labiaColor = "#F977A3";
							colorSlave.lipsColor = "#714536";
							break;
						case "beige":
						case "dark beige":
						case "light brown":
							colorSlave.skinColor = "#784F2F";
							colorSlave.areolaColor = "#583E2F";
							colorSlave.labiaColor = "#F977A3";
							colorSlave.lipsColor = "#5d2f1b";
							break;
						case "brown":
							colorSlave.skinColor = "#784F2F";
							colorSlave.areolaColor = "#583E2F";
							colorSlave.labiaColor = "#F977A3";
							colorSlave.lipsColor = "#714536";
							break;
						case "dark brown":
							colorSlave.skinColor = "#65422C";
							colorSlave.areolaColor = "#4A3A33";
							colorSlave.labiaColor = "#F977A3";
							break;
						case "black":
						case "ebony":
							colorSlave.skinColor = "#583E2F";
							colorSlave.areolaColor = "#3F3A38";
							colorSlave.labiaColor = "#F977A3";
							colorSlave.lipsColor = "#403030";
							break;
						case "pure black":
							colorSlave.skinColor = "#583E2F";
							colorSlave.areolaColor = "#3F3A38";
							colorSlave.labiaColor = "#F977A3";
							break;
						default:
							colorSlave.skinColor = "#D58E5F";
							colorSlave.areolaColor = "#B17777";
							colorSlave.labiaColor = "#F977A3";
							colorSlave.lipsColor = "#9e4c44";
					}
					break;

				case "catgirl":
					switch (artSlave.skin) {
						case "pure white":
						case "ivory":
						case "white":
							colorSlave.skinColor = "#F4EAF0";
							colorSlave.areolaColor = "#FCCCDC";
							colorSlave.labiaColor = "#F977A3";
							break;
						case "extremely pale":
						case "very pale":
							colorSlave.skinColor = "#F4EAF0";
							colorSlave.areolaColor = "#FCCCDC";
							colorSlave.labiaColor = "#F977A3";
							colorSlave.lipsColor = "#ffb9ca";
							break;
						case "pale":
							colorSlave.skinColor = "#F5E1DF";
							colorSlave.areolaColor = "#EFBFCA";
							colorSlave.labiaColor = "#F977A3";
							colorSlave.lipsColor = "#ffb9ca";
							break;
						case "extremely fair":
							colorSlave.skinColor = "#F5E1DF";
							colorSlave.areolaColor = "#EFBFCA";
							colorSlave.labiaColor = "#F977A3";
							break;
						case "very fair":
							colorSlave.skinColor = "#F5D5C9";
							colorSlave.areolaColor = "#E2B4B9";
							colorSlave.labiaColor = "#F977A3";
							break;
						case "fair":
							colorSlave.skinColor = "#F5D5C9";
							colorSlave.areolaColor = "#E2B4B9";
							colorSlave.labiaColor = "#F977A3";
							colorSlave.lipsColor = "#ce6876";
							break;
						case "light":
							colorSlave.skinColor = "#F4C9AA";
							colorSlave.areolaColor = "#F19795";
							colorSlave.labiaColor = "#F977A3";
							colorSlave.lipsColor = "#ce6876";
							break;
						case "light olive":
							colorSlave.skinColor = "#E1B585";
							colorSlave.areolaColor = "#C39696";
							colorSlave.labiaColor = "#F977A3";
							break;
						case "tan":
							colorSlave.skinColor = "#E1B585";
							colorSlave.areolaColor = "#C39696";
							colorSlave.labiaColor = "#F977A3";
							colorSlave.lipsColor = "#c1a785";
							break;
						case "olive":
							colorSlave.skinColor = "#D58E5F";
							colorSlave.areolaColor = "#B17777";
							colorSlave.labiaColor = "#F977A3";
							colorSlave.lipsColor = "#9e4c44";
							break;
						case "bronze":
							colorSlave.skinColor = "#D58E5F";
							colorSlave.areolaColor = "#B17777";
							colorSlave.labiaColor = "#F977A3";
							break;
						case "dark olive":
							colorSlave.skinColor = "#A2805C";
							colorSlave.areolaColor = "#8E6454";
							colorSlave.labiaColor = "#F977A3";
							break;
						case "dark":
						case "light beige":
							colorSlave.skinColor = "#825633";
							colorSlave.areolaColor = "#734B2F";
							colorSlave.labiaColor = "#F977A3";
							colorSlave.lipsColor = "#714536";
							break;
						case "beige":
						case "dark beige":
						case "light brown":
							colorSlave.skinColor = "#784F2F";
							colorSlave.areolaColor = "#583E2F";
							colorSlave.labiaColor = "#F977A3";
							colorSlave.lipsColor = "#5d2f1b";
							break;
						case "brown":
							colorSlave.skinColor = "#784F2F";
							colorSlave.areolaColor = "#583E2F";
							colorSlave.labiaColor = "#F977A3";
							colorSlave.lipsColor = "#714536";
							break;
						case "dark brown":
							colorSlave.skinColor = "#65422C";
							colorSlave.areolaColor = "#4A3A33";
							colorSlave.labiaColor = "#F977A3";
							break;
						case "black":
						case "ebony":
							colorSlave.skinColor = "#583E2F";
							colorSlave.areolaColor = "#3F3A38";
							colorSlave.labiaColor = "#F977A3";
							colorSlave.lipsColor = "#403030";
							break;
						case "pure black":
							colorSlave.skinColor = "#583E2F";
							colorSlave.areolaColor = "#3F3A38";
							colorSlave.labiaColor = "#F977A3";
							break;
						case "red":
							colorSlave.skinColor = "#bc4949";
							colorSlave.areolaColor = "#C96D6D";
							colorSlave.labiaColor = "#F977A3";
							colorSlave.lipsColor = "#b04040";
							break;
						case "yellow":
							colorSlave.skinColor = "#e6e673";
							colorSlave.areolaColor = "#E7DF7D";
							colorSlave.labiaColor = "#F977A3";
							colorSlave.lipsColor = "#e0d050";
							break;
						case "black and white striped":
							colorSlave.skinColor = "#1c1309";
							colorSlave.areolaColor = "#FCCCDC";
							colorSlave.labiaColor = "#F977A3";
							break;
						default:
							colorSlave.skinColor = "#D58E5F";
							colorSlave.areolaColor = "#B17777";
							colorSlave.labiaColor = "#F977A3";
							colorSlave.lipsColor = "#9e4c44";
					}
					break;

				case "black":
					switch (artSlave.skin) {
						case "pure white":
						case "ivory":
						case "white":
							colorSlave.skinColor = "#FEE4CA";
							colorSlave.areolaColor = "#E0B3A2";
							colorSlave.labiaColor = "#F977A3";
							break;
						case "extremely pale":
						case "very pale":
							colorSlave.skinColor = "#FEE4CA";
							colorSlave.areolaColor = "#E0B3A2";
							colorSlave.labiaColor = "#F977A3";
							colorSlave.lipsColor = "#ffb9ca";
							break;
						case "pale":
							colorSlave.skinColor = "#E3C5A7";
							colorSlave.areolaColor = "#EFBDC9";
							colorSlave.labiaColor = "#CC9B88";
							colorSlave.lipsColor = "#ffb9ca";
							break;
						case "extremely fair":
							colorSlave.skinColor = "#E3C5A7";
							colorSlave.areolaColor = "#CC9B88";
							colorSlave.labiaColor = "#CC9B88";
							break;
						case "very fair":
							colorSlave.skinColor = "#DEB892";
							colorSlave.areolaColor = "#AB806F";
							colorSlave.labiaColor = "#F977A3";
							break;
						case "fair":
							colorSlave.skinColor = "#DEB892";
							colorSlave.areolaColor = "#AB806F";
							colorSlave.labiaColor = "#F977A3";
							colorSlave.lipsColor = "#ce6876";
							break;
						case "light":
							colorSlave.skinColor = "#D59D73";
							colorSlave.areolaColor = "#8D6859";
							colorSlave.labiaColor = "#F977A3";
							colorSlave.lipsColor = "#ce6876";
							break;
						case "light olive":
							colorSlave.skinColor = "#AC7C4A";
							colorSlave.areolaColor = "#7C594B";
							colorSlave.labiaColor = "#F977A3";
							break;
						case "sun tanned":
						case "spray tanned":
						case "tan":
							colorSlave.skinColor = "#AC7C4A";
							colorSlave.areolaColor = "#7C594B";
							colorSlave.labiaColor = "#F977A3";
							colorSlave.lipsColor = "#c1a785";
							break;
						case "olive":
							colorSlave.skinColor = "#985C34";
							colorSlave.areolaColor = "#764B3A";
							colorSlave.labiaColor = "#F977A3";
							colorSlave.lipsColor = "#9e4c44";
							break;
						case "bronze":
							colorSlave.skinColor = "#985C34";
							colorSlave.areolaColor = "#764B3A";
							colorSlave.labiaColor = "#F977A3";
							break;
						case "dark olive":
							colorSlave.skinColor = "#745C42";
							colorSlave.areolaColor = "#63463B";
							colorSlave.labiaColor = "#F977A3";
							break;
						case "dark":
						case "light beige":
							colorSlave.skinColor = "#65422C";
							colorSlave.areolaColor = "#4B3121";
							colorSlave.labiaColor = "#F977A3";
							colorSlave.lipsColor = "#714536";
							break;
						case "beige":
						case "dark beige":
						case "light brown":
							colorSlave.skinColor = "#5A3C24";
							colorSlave.areolaColor = "#493326";
							colorSlave.labiaColor = "#F977A3";
							colorSlave.lipsColor = "#5d2f1b";
							break;
						case "brown":
							colorSlave.skinColor = "#5A3C24";
							colorSlave.areolaColor = "#493326";
							colorSlave.labiaColor = "#F977A3";
							colorSlave.lipsColor = "#714536";
							break;
						case "dark brown":
							colorSlave.skinColor = "#583E2F";
							colorSlave.areolaColor = "#46362C";
							colorSlave.labiaColor = "#F977A3";
							break;
						case "black":
							colorSlave.skinColor = "#583D3D";
							colorSlave.areolaColor = "#3B3028";
							colorSlave.labiaColor = "#F977A3";
							break;
						case "ebony":
							colorSlave.skinColor = "#4A3A33";
							colorSlave.areolaColor = "#332B27";
							colorSlave.labiaColor = "#F977A3";
							colorSlave.lipsColor = "#403030";
							break;
						case "pure black":
							colorSlave.skinColor = "#312926";
							colorSlave.areolaColor = "#181616";
							colorSlave.labiaColor = "#F977A3";
							break;
						default:
							colorSlave.skinColor = "#985C34";
							colorSlave.areolaColor = "#764B3A";
							colorSlave.labiaColor = "#F977A3";
							colorSlave.lipsColor = "#9e4c44";
					}
					break;

				case "latina":
					switch (artSlave.skin) {
						case "pure white":
						case "ivory":
						case "white":
							colorSlave.skinColor = "#FEDECE";
							colorSlave.areolaColor = "#E3BBAB";
							colorSlave.labiaColor = "#F977A3";
							break;
						case "extremely pale":
						case "very pale":
							colorSlave.skinColor = "#FEDECE";
							colorSlave.areolaColor = "#E3BBAB";
							colorSlave.labiaColor = "#F977A3";
							colorSlave.lipsColor = "#ffb9ca";
							break;
						case "pale":
							colorSlave.skinColor = "#E6C2B0";
							colorSlave.areolaColor = "#D1A695";
							colorSlave.labiaColor = "#F977A3";
							colorSlave.lipsColor = "#ffb9ca";
							break;
						case "extremely fair":
							colorSlave.skinColor = "#E6C2B0";
							colorSlave.areolaColor = "#D1A695";
							colorSlave.labiaColor = "#F977A3";
							break;
						case "very fair":
							colorSlave.skinColor = "#E1B59F";
							colorSlave.areolaColor = "#B48D7E";
							colorSlave.labiaColor = "#F977A3";
							break;
						case "fair":
							colorSlave.skinColor = "#E1B59F";
							colorSlave.areolaColor = "#B48D7E";
							colorSlave.labiaColor = "#F977A3";
							colorSlave.lipsColor = "#ce6876";
							break;
						case "light":
							colorSlave.skinColor = "#DAA782";
							colorSlave.areolaColor = "#9E7666";
							colorSlave.labiaColor = "#F977A3";
							colorSlave.lipsColor = "#ce6876";
							break;
						case "light olive":
							colorSlave.skinColor = "#B27554";
							colorSlave.areolaColor = "#92684C";
							colorSlave.labiaColor = "#F977A3";
							break;
						case "sun tanned":
						case "spray tanned":
						case "tan":
							colorSlave.skinColor = "#B27554";
							colorSlave.areolaColor = "#92684C";
							colorSlave.labiaColor = "#F977A3";
							colorSlave.lipsColor = "#c1a785";
							break;
						case "olive":
							colorSlave.skinColor = "#B6784E";
							colorSlave.areolaColor = "#8F5A45";
							colorSlave.labiaColor = "#F977A3";
							colorSlave.lipsColor = "#9e4c44";
							break;
						case "bronze":
							colorSlave.skinColor = "#B6784E";
							colorSlave.areolaColor = "#8F5A45";
							colorSlave.labiaColor = "#F977A3";
							break;
						case "dark olive":
							colorSlave.skinColor = "#8B644F";
							colorSlave.areolaColor = "#7B5749";
							colorSlave.labiaColor = "#F977A3";
							break;
						case "dark":
						case "light beige":
							colorSlave.skinColor = "#775031";
							colorSlave.areolaColor = "#69452F";
							colorSlave.labiaColor = "#F977A3";
							colorSlave.lipsColor = "#714536";
							break;
						case "beige":
						case "dark beige":
						case "light brown":
							colorSlave.skinColor = "#774A31";
							colorSlave.areolaColor = "#614330";
							colorSlave.labiaColor = "#F977A3";
							colorSlave.lipsColor = "#5d2f1b";
							break;
						case "brown":
							colorSlave.skinColor = "#774A31";
							colorSlave.areolaColor = "#614330";
							colorSlave.labiaColor = "#F977A3";
							colorSlave.lipsColor = "#714536";
							break;
						case "dark brown":
							colorSlave.skinColor = "#74523E";
							colorSlave.areolaColor = "#573F30";
							colorSlave.labiaColor = "#F977A3";
							break;
						case "black":
							colorSlave.skinColor = "#6B4B4B";
							colorSlave.areolaColor = "#473426";
							colorSlave.labiaColor = "#F977A3";
							break;
						case "ebony":
							colorSlave.skinColor = "#634F45";
							colorSlave.areolaColor = "#4D3A2E";
							colorSlave.labiaColor = "#F977A3";
							colorSlave.lipsColor = "#403030";
							break;
						case "pure black":
							colorSlave.skinColor = "#634F45";
							colorSlave.areolaColor = "#4D3A2E";
							colorSlave.labiaColor = "#F977A3";
							break;
						default:
							colorSlave.skinColor = "#B6784E";
							colorSlave.areolaColor = "#8F5A45";
							colorSlave.labiaColor = "#F977A3";
							colorSlave.lipsColor = "#9e4c44";
					}
					break;

				case "asian":
					switch (artSlave.skin) {
						case "pure white":
						case "ivory":
						case "white":
							colorSlave.skinColor = "#FFF8EE";
							colorSlave.areolaColor = "#F7DBD0";
							colorSlave.labiaColor = "#F977A3";
							break;
						case "extremely pale":
						case "very pale":
							colorSlave.skinColor = "#FFF8EE";
							colorSlave.areolaColor = "#F7DBD0";
							colorSlave.labiaColor = "#F977A3";
							colorSlave.lipsColor = "#ffb9ca";
							break;
						case "pale":
							colorSlave.skinColor = "#F5E7DC";
							colorSlave.areolaColor = "#EABFB3";
							colorSlave.labiaColor = "#F977A3";
							colorSlave.lipsColor = "#ffb9ca";
							break;
						case "extremely fair":
							colorSlave.skinColor = "#F5E7DC";
							colorSlave.areolaColor = "#EABFB3";
							colorSlave.labiaColor = "#F977A3";
							break;
						case "very fair":
							colorSlave.skinColor = "#F5D4B5";
							colorSlave.areolaColor = "#CB988B";
							colorSlave.labiaColor = "#F977A3";
							break;
						case "fair":
							colorSlave.skinColor = "#F5D4B5";
							colorSlave.areolaColor = "#CB988B";
							colorSlave.labiaColor = "#F977A3";
							colorSlave.lipsColor = "#ce6876";
							break;
						case "light":
							colorSlave.skinColor = "#F4D1A3";
							colorSlave.areolaColor = "#BA8E83";
							colorSlave.labiaColor = "#F977A3";
							colorSlave.lipsColor = "#ce6876";
							break;
						case "light olive":
							colorSlave.skinColor = "#CFB48D";
							colorSlave.areolaColor = "#AC8074";
							colorSlave.labiaColor = "#F977A3";
							break;
						case "sun tanned":
						case "spray tanned":
						case "tan":
							colorSlave.skinColor = "#CFB48D";
							colorSlave.areolaColor = "#AC8074";
							colorSlave.labiaColor = "#F977A3";
							colorSlave.lipsColor = "#c1a785";
							break;
						case "olive":
							colorSlave.skinColor = "#C38C4D";
							colorSlave.areolaColor = "#A67A6F";
							colorSlave.labiaColor = "#F977A3";
							colorSlave.lipsColor = "#9e4c44";
							break;
						case "bronze":
							colorSlave.skinColor = "#C38C4D";
							colorSlave.areolaColor = "#A67A6F";
							colorSlave.labiaColor = "#F977A3";
							break;
						case "dark olive":
							colorSlave.skinColor = "#9A774A";
							colorSlave.areolaColor = "#855E4E";
							colorSlave.labiaColor = "#F977A3";
							colorSlave.lipsColor = "#9e4c44";
							break;
						case "dark":
						case "light beige":
							colorSlave.skinColor = "#855834";
							colorSlave.areolaColor = "#734B2F";
							colorSlave.labiaColor = "#F977A3";
							colorSlave.lipsColor = "#714536";
							break;
						case "beige":
						case "dark beige":
						case "light brown":
							colorSlave.skinColor = "#83522B";
							colorSlave.areolaColor = "#68442A";
							colorSlave.labiaColor = "#F977A3";
							colorSlave.lipsColor = "#5d2f1b";
							break;
						case "brown":
							colorSlave.skinColor = "#83522B";
							colorSlave.areolaColor = "#68442A";
							colorSlave.labiaColor = "#F977A3";
							colorSlave.lipsColor = "#714536";
							break;
						case "dark brown":
						case "black":
							colorSlave.skinColor = "#724826";
							colorSlave.areolaColor = "#5C3D26";
							colorSlave.labiaColor = "#F977A3";
							break;
						case "ebony":
							colorSlave.skinColor = "#583E2F";
							colorSlave.areolaColor = "#3F3A38";
							colorSlave.labiaColor = "#F977A3";
							colorSlave.lipsColor = "#403030";
							break;
						case "pure black":
							colorSlave.skinColor = "#583E2F";
							colorSlave.areolaColor = "#3F3A38";
							colorSlave.labiaColor = "#F977A3";
							break;
						default:
							colorSlave.skinColor = "#C38C4D";
							colorSlave.areolaColor = "#A67A6F";
							colorSlave.labiaColor = "#F977A3";
							colorSlave.lipsColor = "#9e4c44";
					}
					break;

				case "middle eastern":
					switch (artSlave.skin) {
						case "pure white":
						case "ivory":
						case "white":
							colorSlave.skinColor = "#E8CFCF";
							colorSlave.areolaColor = "#DCADBC";
							colorSlave.labiaColor = "#F977A3";
							break;
						case "extremely pale":
						case "very pale":
							colorSlave.skinColor = "#E8CFCF";
							colorSlave.areolaColor = "#DCADBC";
							colorSlave.labiaColor = "#F977A3";
							colorSlave.lipsColor = "#ffb9ca";
							break;
						case "pale":
							colorSlave.skinColor = "#FBCCC6";
							colorSlave.areolaColor = "#E79E8B";
							colorSlave.labiaColor = "#F977A3";
							colorSlave.lipsColor = "#ffb9ca";
							break;
						case "extremely fair":
							colorSlave.skinColor = "#FBCCC6";
							colorSlave.areolaColor = "#E79E8B";
							colorSlave.labiaColor = "#F977A3";
							break;
						case "very fair":
							colorSlave.skinColor = "#EAAB92";
							colorSlave.areolaColor = "#D27B64";
							colorSlave.labiaColor = "#F977A3";
							break;
						case "fair":
							colorSlave.skinColor = "#EAAB92";
							colorSlave.areolaColor = "#D27B64";
							colorSlave.labiaColor = "#F977A3";
							colorSlave.lipsColor = "#ce6876";
							break;
						case "light":
							colorSlave.skinColor = "#EDA571";
							colorSlave.areolaColor = "#B16854";
							colorSlave.labiaColor = "#F977A3";
							colorSlave.lipsColor = "#ce6876";
							break;
						case "light olive":
							colorSlave.skinColor = "#CC8D53";
							colorSlave.areolaColor = "#A7624F";
							colorSlave.labiaColor = "#F977A3";
							break;
						case "sun tanned":
						case "spray tanned":
						case "tan":
							colorSlave.skinColor = "#CC8D53";
							colorSlave.areolaColor = "#A7624F";
							colorSlave.labiaColor = "#F977A3";
							colorSlave.lipsColor = "#c1a785";
							break;
						case "olive":
							colorSlave.skinColor = "#CA7136";
							colorSlave.areolaColor = "#9B5959";
							colorSlave.labiaColor = "#F977A3";
							colorSlave.lipsColor = "#9e4c44";
							break;
						case "bronze":
							colorSlave.skinColor = "#CA7136";
							colorSlave.areolaColor = "#9B5959";
							colorSlave.labiaColor = "#F977A3";
							break;
						case "dark olive":
							colorSlave.skinColor = "#84684A";
							colorSlave.areolaColor = "#735143";
							colorSlave.labiaColor = "#F977A3";
							break;
						case "dark":
						case "light beige":
							colorSlave.skinColor = "#684528";
							colorSlave.areolaColor = "#563826";
							colorSlave.labiaColor = "#F977A3";
							colorSlave.lipsColor = "#714536";
							break;
						case "beige":
						case "dark beige":
						case "light brown":
							colorSlave.skinColor = "#6E4730";
							colorSlave.areolaColor = "#604534";
							colorSlave.labiaColor = "#F977A3";
							colorSlave.lipsColor = "#5d2f1b";
							break;
						case "brown":
							colorSlave.skinColor = "#6E4730";
							colorSlave.areolaColor = "#604534";
							colorSlave.labiaColor = "#F977A3";
							colorSlave.lipsColor = "#714536";
							break;
						case "dark brown":
						case "black":
							colorSlave.skinColor = "#604534 ";
							colorSlave.areolaColor = "#514039";
							colorSlave.labiaColor = "#F977A3";
							break;
						case "ebony":
							colorSlave.skinColor = "#583E2F";
							colorSlave.areolaColor = "#3F3A38";
							colorSlave.labiaColor = "#F977A3";
							colorSlave.lipsColor = "#403030";
							break;
						case "pure black":
							colorSlave.skinColor = "#583E2F";
							colorSlave.areolaColor = "#3F3A38";
							colorSlave.labiaColor = "#F977A3";
							break;
						default:
							colorSlave.skinColor = "#CA7136";
							colorSlave.areolaColor = "#9B5959";
							colorSlave.labiaColor = "#F977A3";
							colorSlave.lipsColor = "#9e4c44";
					}
					break;

				case "amerindian":
					switch (artSlave.skin) {
						case "pure white":
						case "ivory":
						case "white":
							colorSlave.skinColor = "#FDE4BF";
							colorSlave.areolaColor = "#F0BEAA";
							colorSlave.labiaColor = "#F977A3";
							break;
						case "extremely pale":
						case "very pale":
							colorSlave.skinColor = "#FDE4BF";
							colorSlave.areolaColor = "#F0BEAA";
							colorSlave.labiaColor = "#F977A3";
							colorSlave.lipsColor = "#ffb9ca";
							break;
						case "pale":
							colorSlave.skinColor = "#F5E7DC";
							colorSlave.areolaColor = "#CDA499";
							colorSlave.labiaColor = "#F977A3";
							colorSlave.lipsColor = "#ffb9ca";
							break;
						case "extremely fair":
							colorSlave.skinColor = "#F5E7DC";
							colorSlave.areolaColor = "#CDA499";
							colorSlave.labiaColor = "#F977A3";
							break;
						case "very fair":
							colorSlave.skinColor = "#F5D4B5";
							colorSlave.areolaColor = "#CB988B";
							colorSlave.labiaColor = "#F977A3";
							break;
						case "fair":
							colorSlave.skinColor = "#F5D4B5";
							colorSlave.areolaColor = "#CB988B";
							colorSlave.labiaColor = "#F977A3";
							colorSlave.lipsColor = "#ce6876";
							break;
						case "light":
							colorSlave.skinColor = "#F4D1A3";
							colorSlave.areolaColor = "#BA8E83";
							colorSlave.labiaColor = "#F977A3";
							colorSlave.lipsColor = "#ce6876";
							break;
						case "light olive":
							colorSlave.skinColor = "#CFB48D";
							colorSlave.areolaColor = "#AC8074";
							colorSlave.labiaColor = "#F977A3";
							break;
						case "sun tanned":
						case "spray tanned":
						case "tan":
							colorSlave.skinColor = "#CFB48D";
							colorSlave.areolaColor = "#AC8074";
							colorSlave.labiaColor = "#F977A3";
							colorSlave.lipsColor = "#c1a785";
							break;
						case "olive":
							colorSlave.skinColor = "#C38C4D";
							colorSlave.areolaColor = "#A67A6F";
							colorSlave.labiaColor = "#F977A3";
							colorSlave.lipsColor = "#9e4c44";
							break;
						case "bronze":
							colorSlave.skinColor = "#C38C4D";
							colorSlave.areolaColor = "#A67A6F";
							colorSlave.labiaColor = "#F977A3";
							break;
						case "dark olive":
							colorSlave.skinColor = "#9A774A";
							colorSlave.areolaColor = "#855E4E";
							colorSlave.labiaColor = "#F977A3";
							break;
						case "dark":
						case "light beige":
							colorSlave.skinColor = "#855834";
							colorSlave.areolaColor = "#734B2F";
							colorSlave.labiaColor = "#F977A3";
							colorSlave.lipsColor = "#714536";
							break;
						case "beige":
						case "dark beige":
						case "light brown":
							colorSlave.skinColor = "#83522B";
							colorSlave.areolaColor = "#68442A";
							colorSlave.labiaColor = "#F977A3";
							colorSlave.lipsColor = "#5d2f1b";
							break;
						case "brown":
							colorSlave.skinColor = "#83522B";
							colorSlave.areolaColor = "#68442A";
							colorSlave.labiaColor = "#F977A3";
							colorSlave.lipsColor = "#714536";
							break;
						case "dark brown":
						case "black":
							colorSlave.skinColor = "#724826";
							colorSlave.areolaColor = "#5C3D26";
							colorSlave.labiaColor = "#F977A3";
							break;
						case "ebony":
							colorSlave.skinColor = "#583E2F";
							colorSlave.areolaColor = "#3F3A38";
							colorSlave.labiaColor = "#F977A3";
							colorSlave.lipsColor = "#403030";
							break;
						case "pure black":
							colorSlave.skinColor = "#583E2F";
							colorSlave.areolaColor = "#3F3A38";
							colorSlave.labiaColor = "#F977A3";
							break;
						default:
							colorSlave.skinColor = "#C38C4D";
							colorSlave.areolaColor = "#A67A6F";
							colorSlave.labiaColor = "#F977A3";
							colorSlave.lipsColor = "#9e4c44";
					}
					break;

				case "southern european":
					switch (artSlave.skin) {
						case "pure white":
						case "ivory":
						case "white":
							colorSlave.skinColor = "#EBDBE4";
							colorSlave.areolaColor = "#FFE4E0";
							colorSlave.labiaColor = "#F977A3";
							break;
						case "extremely pale":
						case "very pale":
							colorSlave.skinColor = "#EBDBE4";
							colorSlave.areolaColor = "#FFE4E0";
							colorSlave.labiaColor = "#F977A3";
							colorSlave.lipsColor = "#ffb9ca";
							break;
						case "pale":
							colorSlave.skinColor = "#F0D0CC";
							colorSlave.areolaColor = "#EAACBA";
							colorSlave.labiaColor = "#F977A3";
							colorSlave.lipsColor = "#ffb9ca";
							break;
						case "extremely fair":
							colorSlave.skinColor = "#F0D0CC";
							colorSlave.areolaColor = "#EAACBA";
							colorSlave.labiaColor = "#F977A3";
							break;
						case "very fair":
							colorSlave.skinColor = "#F1C6B5";
							colorSlave.areolaColor = "#DCA2A9";
							colorSlave.labiaColor = "#F977A3";
							break;
						case "fair":
							colorSlave.skinColor = "#F1C6B5";
							colorSlave.areolaColor = "#DCA2A9";
							colorSlave.labiaColor = "#F977A3";
							colorSlave.lipsColor = "#ce6876";
							break;
						case "light":
							colorSlave.skinColor = "#F2BC94";
							colorSlave.areolaColor = "#EE8280";
							colorSlave.labiaColor = "#F977A3";
							colorSlave.lipsColor = "#ce6876";
							break;
						case "light olive":
							colorSlave.skinColor = "#DCA972";
							colorSlave.areolaColor = "#BF7577";
							colorSlave.labiaColor = "#F977A3";
							break;
						case "sun tanned":
						case "spray tanned":
						case "tan":
							colorSlave.skinColor = "#DCA972";
							colorSlave.areolaColor = "#BF7577";
							colorSlave.labiaColor = "#F977A3";
							colorSlave.lipsColor = "#c1a785";
							break;
						case "olive":
							colorSlave.skinColor = "#D0814C";
							colorSlave.areolaColor = "#A96767";
							colorSlave.labiaColor = "#F977A3";
							colorSlave.lipsColor = "#9e4c44";
							break;
						case "bronze":
							colorSlave.skinColor = "#D0814C";
							colorSlave.areolaColor = "#A96767";
							colorSlave.labiaColor = "#F977A3";
							break;
						case "dark olive":
							colorSlave.skinColor = "#937453";
							colorSlave.areolaColor = "#7F5A4B";
							colorSlave.labiaColor = "#F977A3";
							break;
						case "dark":
						case "light beige":
							colorSlave.skinColor = "#7F5431";
							colorSlave.areolaColor = "#734B2F";
							colorSlave.labiaColor = "#F977A3";
							colorSlave.lipsColor = "#714536";
							break;
						case "beige":
						case "dark beige":
						case "light brown":
							colorSlave.skinColor = "#784F2F";
							colorSlave.areolaColor = "#583E2F";
							colorSlave.labiaColor = "#F977A3";
							colorSlave.lipsColor = "#5d2f1b";
							break;
						case "brown":
							colorSlave.skinColor = "#784F2F";
							colorSlave.areolaColor = "#583E2F";
							colorSlave.labiaColor = "#F977A3";
							colorSlave.lipsColor = "#714536";
							break;
						case "dark brown":
						case "black":
							colorSlave.skinColor = "#65422C";
							colorSlave.areolaColor = "#4A3A33";
							colorSlave.labiaColor = "#F977A3";
							break;
						case "ebony":
							colorSlave.skinColor = "#583E2F";
							colorSlave.areolaColor = "#3F3A38";
							colorSlave.labiaColor = "#F977A3";
							colorSlave.lipsColor = "#403030";
							break;
						case "pure black":
							colorSlave.skinColor = "#583E2F";
							colorSlave.areolaColor = "#3F3A38";
							colorSlave.labiaColor = "#F977A3";
							break;
						default:
							colorSlave.skinColor = "#D0814C";
							colorSlave.areolaColor = "#A96767";
							colorSlave.labiaColor = "#F977A3";
							colorSlave.lipsColor = "#9e4c44";
					}
					break;

				case "semitic":
					switch (artSlave.skin) {
						case "pure white":
						case "ivory":
						case "white":
							colorSlave.skinColor = "#E8CFCF";
							colorSlave.areolaColor = "#DCADBC";
							colorSlave.labiaColor = "#F977A3";
							break;
						case "extremely pale":
						case "very pale":
							colorSlave.skinColor = "#E8CFCF";
							colorSlave.areolaColor = "#DCADBC";
							colorSlave.labiaColor = "#F977A3";
							colorSlave.lipsColor = "#ffb9ca";
							break;
						case "pale":
							colorSlave.skinColor = "#FBCCC6";
							colorSlave.areolaColor = "#E79E8B";
							colorSlave.labiaColor = "#F977A3";
							colorSlave.lipsColor = "#ffb9ca";
							break;
						case "extremely fair":
							colorSlave.skinColor = "#FBCCC6";
							colorSlave.areolaColor = "#E79E8B";
							colorSlave.labiaColor = "#F977A3";
							break;
						case "very fair":
							colorSlave.skinColor = "#EAAB92";
							colorSlave.areolaColor = "#D27B64";
							colorSlave.labiaColor = "#F977A3";
							break;
						case "fair":
							colorSlave.skinColor = "#EAAB92";
							colorSlave.areolaColor = "#D27B64";
							colorSlave.labiaColor = "#F977A3";
							colorSlave.lipsColor = "#ce6876";
							break;
						case "light":
							colorSlave.skinColor = "#EDA571";
							colorSlave.areolaColor = "#B16854";
							colorSlave.labiaColor = "#F977A3";
							colorSlave.lipsColor = "#ce6876";
							break;
						case "light olive":
							colorSlave.skinColor = "#CC8D53";
							colorSlave.areolaColor = "#A7624F";
							colorSlave.labiaColor = "#F977A3";
							break;
						case "sun tanned":
						case "spray tanned":
						case "tan":
							colorSlave.skinColor = "#CC8D53";
							colorSlave.areolaColor = "#A7624F";
							colorSlave.labiaColor = "#F977A3";
							colorSlave.lipsColor = "#c1a785";
							break;
						case "olive":
							colorSlave.skinColor = "#CA7136";
							colorSlave.areolaColor = "#9B5959";
							colorSlave.labiaColor = "#F977A3";
							colorSlave.lipsColor = "#9e4c44";
							break;
						case "bronze":
							colorSlave.skinColor = "#CA7136";
							colorSlave.areolaColor = "#9B5959";
							colorSlave.labiaColor = "#F977A3";
							break;
						case "dark olive":
							colorSlave.skinColor = "#84684A";
							colorSlave.areolaColor = "#735143";
							colorSlave.labiaColor = "#F977A3";
							break;
						case "dark":
						case "light beige":
							colorSlave.skinColor = "#684528";
							colorSlave.areolaColor = "#563826";
							colorSlave.labiaColor = "#F977A3";
							colorSlave.lipsColor = "#714536";
							break;
						case "beige":
						case "dark beige":
						case "light brown":
							colorSlave.skinColor = "#6E4730";
							colorSlave.areolaColor = "#604534";
							colorSlave.labiaColor = "#F977A3";
							colorSlave.lipsColor = "#5d2f1b";
							break;
						case "brown":
							colorSlave.skinColor = "#6E4730";
							colorSlave.areolaColor = "#604534";
							colorSlave.labiaColor = "#F977A3";
							colorSlave.lipsColor = "#714536";
							break;
						case "dark brown":
						case "black":
							colorSlave.skinColor = "#604534 ";
							colorSlave.areolaColor = "#514039";
							colorSlave.labiaColor = "#F977A3";
							break;
						case "ebony":
							colorSlave.skinColor = "#583E2F";
							colorSlave.areolaColor = "#3F3A38";
							colorSlave.labiaColor = "#F977A3";
							colorSlave.lipsColor = "#403030";
							break;
						case "pure black":
							colorSlave.skinColor = "#583E2F";
							colorSlave.areolaColor = "#3F3A38";
							colorSlave.labiaColor = "#F977A3";
							break;
						default:
							colorSlave.skinColor = "#CA7136";
							colorSlave.areolaColor = "#9B5959";
							colorSlave.labiaColor = "#F977A3";
							colorSlave.lipsColor = "#9e4c44";
					}
					break;

				case "malay":
					switch (artSlave.skin) {
						case "pure white":
						case "ivory":
						case "white":
							colorSlave.skinColor = "#FBD1B2";
							colorSlave.areolaColor = "#F39E7D";
							colorSlave.labiaColor = "#F977A3";
							break;
						case "extremely pale":
						case "very pale":
							colorSlave.skinColor = "#FBD1B2";
							colorSlave.areolaColor = "#F39E7D";
							colorSlave.labiaColor = "#F977A3";
							colorSlave.lipsColor = "#ffb9ca";
							break;
						case "pale":
							colorSlave.skinColor = "#E8B892";
							colorSlave.areolaColor = "#E2856C";
							colorSlave.labiaColor = "#F977A3";
							colorSlave.lipsColor = "#ffb9ca";
							break;
						case "extremely fair":
							colorSlave.skinColor = "#E8B892";
							colorSlave.areolaColor = "#E2856C";
							colorSlave.labiaColor = "#F977A3";
							break;
						case "very fair":
							colorSlave.skinColor = "#EA9870";
							colorSlave.areolaColor = "#BE6C56";
							colorSlave.labiaColor = "#F977A3";
							break;
						case "fair":
							colorSlave.skinColor = "#EA9870";
							colorSlave.areolaColor = "#BE6C56";
							colorSlave.labiaColor = "#F977A3";
							colorSlave.lipsColor = "#ce6876";
							break;
						case "light":
							colorSlave.skinColor = "#EA9760";
							colorSlave.areolaColor = "#AB6755";
							colorSlave.labiaColor = "#F977A3";
							colorSlave.lipsColor = "#ce6876";
							break;
						case "light olive":
							colorSlave.skinColor = "#BA855E";
							colorSlave.areolaColor = "#976051";
							colorSlave.labiaColor = "#F977A3";
							break;
						case "sun tanned":
						case "spray tanned":
						case "tan":
							colorSlave.skinColor = "#BA855E";
							colorSlave.areolaColor = "#976051";
							colorSlave.labiaColor = "#F977A3";
							colorSlave.lipsColor = "#c1a785";
							break;
						case "olive":
							colorSlave.skinColor = "#A46138";
							colorSlave.areolaColor = "#8F5E51";
							colorSlave.labiaColor = "#F977A3";
							colorSlave.lipsColor = "#9e4c44";
							break;
						case "bronze":
							colorSlave.skinColor = "#A46138";
							colorSlave.areolaColor = "#8F5E51";
							colorSlave.labiaColor = "#F977A3";
							break;
						case "dark olive":
							colorSlave.skinColor = "#7C563C";
							colorSlave.areolaColor = "#70493A";
							colorSlave.labiaColor = "#F977A3";
							break;
						case "dark":
						case "light beige":
							colorSlave.skinColor = "#804A28";
							colorSlave.areolaColor = "#5F3F27";
							colorSlave.labiaColor = "#F977A3";
							colorSlave.lipsColor = "#714536";
							break;
						case "beige":
						case "dark beige":
						case "light brown":
							colorSlave.skinColor = "#6F4523";
							colorSlave.areolaColor = "#623C20";
							colorSlave.labiaColor = "#F977A3";
							colorSlave.lipsColor = "#5d2f1b";
							break;
						case "brown":
							colorSlave.skinColor = "#6F4523";
							colorSlave.areolaColor = "#623C20";
							colorSlave.labiaColor = "#F977A3";
							colorSlave.lipsColor = "#714536";
							break;
						case "dark brown":
						case "black":
							colorSlave.skinColor = "#6F3E27";
							colorSlave.areolaColor = "#553823";
							colorSlave.labiaColor = "#F977A3";
							break;
						case "ebony":
							colorSlave.skinColor = "#583E2F";
							colorSlave.areolaColor = "#3F3A38";
							colorSlave.labiaColor = "#F977A3";
							colorSlave.lipsColor = "#403030";
							break;
						case "pure black":
							colorSlave.skinColor = "#583E2F";
							colorSlave.areolaColor = "#3F3A38";
							colorSlave.labiaColor = "#F977A3";
							break;
						default:
							colorSlave.skinColor = "#A46138";
							colorSlave.areolaColor = "#8F5E51";
							colorSlave.labiaColor = "#F977A3";
							colorSlave.lipsColor = "#9e4c44";
					}
					break;

				case "indo-aryan":
					switch (artSlave.skin) {
						case "pure white":
						case "ivory":
						case "white":
							colorSlave.skinColor = "#F8D4BE";
							colorSlave.areolaColor = "#F8B6A4";
							colorSlave.labiaColor = "#F977A3";
							break;
						case "extremely pale":
						case "very pale":
							colorSlave.skinColor = "#F8D4BE";
							colorSlave.areolaColor = "#F8B6A4";
							colorSlave.labiaColor = "#F977A3";
							colorSlave.lipsColor = "#ffb9ca";
							break;
						case "pale":
							colorSlave.skinColor = "#EFCCAF";
							colorSlave.areolaColor = "#EA9B86";
							colorSlave.labiaColor = "#F977A3";
							colorSlave.lipsColor = "#ffb9ca";
							break;
						case "extremely fair":
							colorSlave.skinColor = "#EFCCAF";
							colorSlave.areolaColor = "#EA9B86";
							colorSlave.labiaColor = "#F977A3";
							break;
						case "very fair":
							colorSlave.skinColor = "#FCC49A";
							colorSlave.areolaColor = "#D29577";
							colorSlave.labiaColor = "#F977A3";
							break;
						case "fair":
							colorSlave.skinColor = "#FCC49A";
							colorSlave.areolaColor = "#D29577";
							colorSlave.labiaColor = "#F977A3";
							colorSlave.lipsColor = "#ce6876";
							break;
						case "light":
							colorSlave.skinColor = "#E8B68E";
							colorSlave.areolaColor = "#D08661";
							colorSlave.labiaColor = "#F977A3";
							colorSlave.lipsColor = "#ce6876";
							break;
						case "light olive":
							colorSlave.skinColor = "#C17848";
							colorSlave.areolaColor = "#C36E45";
							colorSlave.labiaColor = "#F977A3";
							break;
						case "sun tanned":
						case "spray tanned":
						case "tan":
							colorSlave.skinColor = "#C17848";
							colorSlave.areolaColor = "#C36E45";
							colorSlave.labiaColor = "#F977A3";
							colorSlave.lipsColor = "#c1a785";
							break;
						case "olive":
							colorSlave.skinColor = "#C17848";
							colorSlave.areolaColor = "#A75A34";
							colorSlave.labiaColor = "#F977A3";
							colorSlave.lipsColor = "#9e4c44";
							break;
						case "bronze":
							colorSlave.skinColor = "#C17848";
							colorSlave.areolaColor = "#A75A34";
							colorSlave.labiaColor = "#F977A3";
							break;
						case "dark olive":
							colorSlave.skinColor = "#83684B";
							colorSlave.areolaColor = "#715043";
							colorSlave.labiaColor = "#F977A3";
							break;
						case "dark":
						case "light beige":
							colorSlave.skinColor = "#8A593C";
							colorSlave.areolaColor = "#714931";
							colorSlave.labiaColor = "#F977A3";
							colorSlave.lipsColor = "#714536";
							break;
						case "beige":
						case "dark beige":
						case "light brown":
							colorSlave.skinColor = "#845834";
							colorSlave.areolaColor = "#614635";
							colorSlave.labiaColor = "#F977A3";
							colorSlave.lipsColor = "#5d2f1b";
							break;
						case "brown":
							colorSlave.skinColor = "#845834";
							colorSlave.areolaColor = "#614635";
							colorSlave.labiaColor = "#F977A3";
							colorSlave.lipsColor = "#714536";
							break;
						case "dark brown":
						case "black":
							colorSlave.skinColor = "#7C5842";
							colorSlave.areolaColor = "#5F4538";
							colorSlave.labiaColor = "#F977A3";
							break;
						case "ebony":
							colorSlave.skinColor = "#6B5449";
							colorSlave.areolaColor = "#473C37";
							colorSlave.labiaColor = "#F977A3";
							colorSlave.lipsColor = "#403030";
							break;
						case "pure black":
							colorSlave.skinColor = "#6B5449";
							colorSlave.areolaColor = "#473C37";
							colorSlave.labiaColor = "#F977A3";
							break;
						default:
							colorSlave.skinColor = "#C17848";
							colorSlave.areolaColor = "#A75A34";
							colorSlave.labiaColor = "#F977A3";
							colorSlave.lipsColor = "#9e4c44";
					}
					break;

				case "pacific islander":
					switch (artSlave.skin) {
						case "pure white":
						case "ivory":
						case "white":
							colorSlave.skinColor = "#FBD1B2";
							colorSlave.areolaColor = "#F39E7D";
							colorSlave.labiaColor = "#F977A3";
							break;
						case "extremely pale":
						case "very pale":
							colorSlave.skinColor = "#FBD1B2";
							colorSlave.areolaColor = "#F39E7D";
							colorSlave.labiaColor = "#F977A3";
							colorSlave.lipsColor = "#ffb9ca";
							break;
						case "pale":
							colorSlave.skinColor = "#E8B892";
							colorSlave.areolaColor = "#E2856C";
							colorSlave.labiaColor = "#F977A3";
							colorSlave.lipsColor = "#ffb9ca";
							break;
						case "extremely fair":
							colorSlave.skinColor = "#E8B892";
							colorSlave.areolaColor = "#E2856C";
							colorSlave.labiaColor = "#F977A3";
							break;
						case "very fair":
							colorSlave.skinColor = "#EA9870";
							colorSlave.areolaColor = "#BE6C56";
							colorSlave.labiaColor = "#F977A3";
							break;
						case "fair":
							colorSlave.skinColor = "#EA9870";
							colorSlave.areolaColor = "#BE6C56";
							colorSlave.labiaColor = "#F977A3";
							colorSlave.lipsColor = "#ce6876";
							break;
						case "light":
							colorSlave.skinColor = "#EA9760";
							colorSlave.areolaColor = "#AB6755";
							colorSlave.labiaColor = "#F977A3";
							colorSlave.lipsColor = "#ce6876";
							break;
						case "light olive":
							colorSlave.skinColor = "#BA855E";
							colorSlave.areolaColor = "#976051";
							colorSlave.labiaColor = "#F977A3";
							break;
						case "sun tanned":
						case "spray tanned":
						case "tan":
							colorSlave.skinColor = "#BA855E";
							colorSlave.areolaColor = "#976051";
							colorSlave.labiaColor = "#F977A3";
							colorSlave.lipsColor = "#c1a785";
							break;
						case "olive":
							colorSlave.skinColor = "#A46138";
							colorSlave.areolaColor = "#8F5E51";
							colorSlave.labiaColor = "#F977A3";
							colorSlave.lipsColor = "#9e4c44";
							break;
						case "bronze":
							colorSlave.skinColor = "#A46138";
							colorSlave.areolaColor = "#8F5E51";
							colorSlave.labiaColor = "#F977A3";
							break;
						case "dark olive":
							colorSlave.skinColor = "#7C563C";
							colorSlave.areolaColor = "#70493A";
							colorSlave.labiaColor = "#F977A3";
							break;
						case "dark":
						case "light beige":
							colorSlave.skinColor = "#804A28";
							colorSlave.areolaColor = "#5F3F27";
							colorSlave.labiaColor = "#F977A3";
							colorSlave.lipsColor = "#714536";
							break;
						case "beige":
						case "dark beige":
						case "light brown":
							colorSlave.skinColor = "#6F4523";
							colorSlave.areolaColor = "#623C20";
							colorSlave.labiaColor = "#F977A3";
							colorSlave.lipsColor = "#5d2f1b";
							break;
						case "brown":
							colorSlave.skinColor = "#6F4523";
							colorSlave.areolaColor = "#623C20";
							colorSlave.labiaColor = "#F977A3";
							colorSlave.lipsColor = "#714536";
							break;
						case "dark brown":
						case "black":
							colorSlave.skinColor = "#6F3E27";
							colorSlave.areolaColor = "#553823";
							colorSlave.labiaColor = "#F977A3";
							break;
						case "ebony":
							colorSlave.skinColor = "#583E2F";
							colorSlave.areolaColor = "#3F3A38";
							colorSlave.labiaColor = "#F977A3";
							colorSlave.lipsColor = "#403030";
							break;
						case "pure black":
							colorSlave.skinColor = "#583E2F";
							colorSlave.areolaColor = "#3F3A38";
							colorSlave.labiaColor = "#F977A3";
							break;
						default:
							colorSlave.skinColor = "#A46138";
							colorSlave.areolaColor = "#8F5E51";
							colorSlave.labiaColor = "#F977A3";
							colorSlave.lipsColor = "#9e4c44";
					}
					break;

				case "mixed race":
					switch (artSlave.skin) {
						case "pure white":
						case "ivory":
						case "white":
							colorSlave.skinColor = "#FEE5CC";
							colorSlave.areolaColor = "#E3BBAB";
							colorSlave.labiaColor = "#F977A3";
							break;
						case "extremely pale":
						case "very pale":
							colorSlave.skinColor = "#FEE5CC";
							colorSlave.areolaColor = "#E3BBAB";
							colorSlave.labiaColor = "#F977A3";
							colorSlave.lipsColor = "#ffb9ca";
							break;
						case "pale":
							colorSlave.skinColor = "#E6C2B0";
							colorSlave.areolaColor = "#D1A695";
							colorSlave.labiaColor = "#F977A3";
							colorSlave.lipsColor = "#ffb9ca";
							break;
						case "extremely fair":
							colorSlave.skinColor = "#E6C2B0";
							colorSlave.areolaColor = "#D1A695";
							colorSlave.labiaColor = "#F977A3";
							break;
						case "very fair":
							colorSlave.skinColor = "#E1B59F";
							colorSlave.areolaColor = "#B48D7E";
							colorSlave.labiaColor = "#F977A3";
							break;
						case "fair":
							colorSlave.skinColor = "#E1B59F";
							colorSlave.areolaColor = "#B48D7E";
							colorSlave.labiaColor = "#F977A3";
							colorSlave.lipsColor = "#ce6876";
							break;
						case "light":
							colorSlave.skinColor = "#DAA782";
							colorSlave.areolaColor = "#9E7666";
							colorSlave.labiaColor = "#F977A3";
							colorSlave.lipsColor = "#ce6876";
							break;
						case "light olive":
							colorSlave.skinColor = "#B27554";
							colorSlave.areolaColor = "#92684C";
							colorSlave.labiaColor = "#F977A3";
							break;
						case "sun tanned":
						case "spray tanned":
						case "tan":
							colorSlave.skinColor = "#B27554";
							colorSlave.areolaColor = "#92684C";
							colorSlave.labiaColor = "#F977A3";
							colorSlave.lipsColor = "#c1a785";
							break;
						case "olive":
							colorSlave.skinColor = "#B6784E";
							colorSlave.areolaColor = "#8F5A45";
							colorSlave.labiaColor = "#F977A3";
							colorSlave.lipsColor = "#9e4c44";
							break;
						case "bronze":
							colorSlave.skinColor = "#B6784E";
							colorSlave.areolaColor = "#8F5A45";
							colorSlave.labiaColor = "#F977A3";
							break;
						case "dark olive":
							colorSlave.skinColor = "#8B644F";
							colorSlave.areolaColor = "#7B5749";
							colorSlave.labiaColor = "#F977A3";
							break;
						case "dark":
						case "light beige":
							colorSlave.skinColor = "#775031";
							colorSlave.areolaColor = "#69452F";
							colorSlave.labiaColor = "#F977A3";
							colorSlave.lipsColor = "#714536";
							break;
						case "beige":
						case "dark beige":
						case "light brown":
							colorSlave.skinColor = "#774A31";
							colorSlave.areolaColor = "#5E4434";
							colorSlave.labiaColor = "#F977A3";
							colorSlave.lipsColor = "#5d2f1b";
							break;
						case "brown":
							colorSlave.skinColor = "#774A31";
							colorSlave.areolaColor = "#5E4434";
							colorSlave.labiaColor = "#F977A3";
							colorSlave.lipsColor = "#714536";
							break;
						case "dark brown":
							colorSlave.skinColor = "#74523E";
							colorSlave.areolaColor = "#574135";
							colorSlave.labiaColor = "#F977A3";
							break;
						case "black":
							colorSlave.skinColor = "#6B4B4B";
							colorSlave.areolaColor = "#413228";
							colorSlave.labiaColor = "#F977A3";
							break;
						case "ebony":
							colorSlave.skinColor = "#634F45";
							colorSlave.areolaColor = "#4E3C32";
							colorSlave.labiaColor = "#F977A3";
							colorSlave.lipsColor = "#403030";
							break;
						case "pure black":
							colorSlave.skinColor = "#634F45";
							colorSlave.areolaColor = "#4E3C32";
							colorSlave.labiaColor = "#F977A3";
							break;
						default:
							colorSlave.skinColor = "#B6784E";
							colorSlave.areolaColor = "#8F5A45";
							colorSlave.labiaColor = "#F977A3";
							colorSlave.lipsColor = "#9e4c44";
					}
					break;

				default:
					switch (artSlave.skin) {
						case "pure white":
						case "ivory":
						case "white":
							colorSlave.skinColor = "#FEE5CC";
							colorSlave.areolaColor = "#E3BBAB";
							colorSlave.labiaColor = "#F977A3";
							break;
						case "extremely pale":
						case "very pale":
							colorSlave.skinColor = "#FEE5CC";
							colorSlave.areolaColor = "#E3BBAB";
							colorSlave.labiaColor = "#F977A3";
							colorSlave.lipsColor = "#ffb9ca";
							break;
						case "pale":
							colorSlave.skinColor = "#E6C2B0";
							colorSlave.areolaColor = "#D1A695";
							colorSlave.labiaColor = "#F977A3";
							colorSlave.lipsColor = "#ffb9ca";
							break;
						case "extremely fair":
							colorSlave.skinColor = "#E6C2B0";
							colorSlave.areolaColor = "#D1A695";
							colorSlave.labiaColor = "#F977A3";
							break;
						case "very fair":
							colorSlave.skinColor = "#E1B59F";
							colorSlave.areolaColor = "#B48D7E";
							colorSlave.labiaColor = "#F977A3";
							break;
						case "fair":
							colorSlave.skinColor = "#E1B59F";
							colorSlave.areolaColor = "#B48D7E";
							colorSlave.labiaColor = "#F977A3";
							colorSlave.lipsColor = "#ce6876";
							break;
						case "light":
							colorSlave.skinColor = "#DAA782";
							colorSlave.areolaColor = "#9E7666";
							colorSlave.labiaColor = "#F977A3";
							colorSlave.lipsColor = "#ce6876";
							break;
						case "light olive":
							colorSlave.skinColor = "#B27554";
							colorSlave.areolaColor = "#92684C";
							colorSlave.labiaColor = "#F977A3";
							break;
						case "sun tanned":
						case "spray tanned":
						case "tan":
							colorSlave.skinColor = "#B27554";
							colorSlave.areolaColor = "#92684C";
							colorSlave.labiaColor = "#F977A3";
							colorSlave.lipsColor = "#c1a785";
							break;
						case "olive":
							colorSlave.skinColor = "#B6784E";
							colorSlave.areolaColor = "#8F5A45";
							colorSlave.labiaColor = "#F977A3";
							colorSlave.lipsColor = "#9e4c44";
							break;
						case "bronze":
							colorSlave.skinColor = "#B6784E";
							colorSlave.areolaColor = "#8F5A45";
							colorSlave.labiaColor = "#F977A3";
							break;
						case "dark olive":
							colorSlave.skinColor = "#8B644F";
							colorSlave.areolaColor = "#7B5749";
							colorSlave.labiaColor = "#F977A3";
							break;
						case "dark":
						case "light beige":
							colorSlave.skinColor = "#775031";
							colorSlave.areolaColor = "#69452F";
							colorSlave.labiaColor = "#F977A3";
							colorSlave.lipsColor = "#714536";
							break;
						case "beige":
						case "dark beige":
						case "light brown":
							colorSlave.skinColor = "#774A31";
							colorSlave.areolaColor = "#5E4434";
							colorSlave.labiaColor = "#F977A3";
							colorSlave.lipsColor = "#5d2f1b";
							break;
						case "brown":
							colorSlave.skinColor = "#774A31";
							colorSlave.areolaColor = "#5E4434";
							colorSlave.labiaColor = "#F977A3";
							colorSlave.lipsColor = "#714536";
							break;
						case "dark brown":
							colorSlave.skinColor = "#74523E";
							colorSlave.areolaColor = "#574135";
							colorSlave.labiaColor = "#F977A3";
							break;
						case "black":
							colorSlave.skinColor = "#6B4B4B";
							colorSlave.areolaColor = "#413228";
							colorSlave.labiaColor = "#F977A3";
							break;
						case "ebony":
							colorSlave.skinColor = "#634F45";
							colorSlave.areolaColor = "#4E3C32";
							colorSlave.labiaColor = "#F977A3";
							colorSlave.lipsColor = "#403030";
							break;
						case "pure black":
							colorSlave.skinColor = "#634F45";
							colorSlave.areolaColor = "#4E3C32";
							colorSlave.labiaColor = "#F977A3";
							break;
						default:
							colorSlave.skinColor = "#B6784E";
							colorSlave.areolaColor = "#8F5A45";
							colorSlave.labiaColor = "#F977A3";
							colorSlave.lipsColor = "#9e4c44";
					}
			}
	}
	colorSlave.lipsColor = (colorSlave.lipsColor === "") ? colorSlave.areolaColor : colorSlave.lipsColor;
	return colorSlave;
};

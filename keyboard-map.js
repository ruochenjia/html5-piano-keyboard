"use strict";

class HTMLKeyboardMap extends HTMLElement {
	constructor() {
		super();
		let shadow = this.attachShadow({mode: "closed"});

		shadow.innerHTML = `<style type="text/css">
row, f-row {
	position: relative;
	display: flex;
	width: fit-content;
	height: fit-content;
	margin: auto;
}

f-row {
	margin-bottom: 10px;
}

key, f-key {
	position: relative;
	display: block;
	width: 40px;
	height: 40px;
	text-align: center;
	line-height: 40px;
	font-size: 12px;
	font-weight: 500;
	color: #000000;
	box-sizing: border-box;
	background-color: #a0a0a0;
	border-style: solid;
	border-width: 2px;
	border-top-color: #f0f0f0;
	border-left-color: #f0f0f0;
	border-bottom-color: #101010;
	border-right-color: #101010;
}

f-key {
	height: 30px;
	line-height: 30px;
}

key[active] {
	border-top-color: #101010;
	border-left-color: #101010;
	border-bottom-color: #f0f0f0;
	border-right-color: #f0f0f0;
}
		</style>
		<f-row>
			<f-key display="Esc" width="1.153846"></f-key>
			<f-key display="F1" width="1.153846"></f-key>
			<f-key display="F2" width="1.153846"></f-key>
			<f-key display="F3" width="1.153846"></f-key>
			<f-key display="F4" width="1.153846"></f-key>
			<f-key display="F5" width="1.153846"></f-key>
			<f-key display="F6" width="1.153846"></f-key>
			<f-key display="F7" width="1.153846"></f-key>
			<f-key display="F8" width="1.153846"></f-key>
			<f-key display="F9" width="1.153846"></f-key>
			<f-key display="F10" width="1.153846"></f-key>
			<f-key display="F11" width="1.153846"></f-key>
			<f-key display="F12" width="1.153846"></f-key>
		</f-row>
		<row>
			<key n="\`" s="~"></key>
			<key n="1" s="!"></key>
			<key n="2" s="@"></key>
			<key n="3" s="#"></key>
			<key n="4" s="$"></key>
			<key n="5" s="%"></key>
			<key n="6" s="^"></key>
			<key n="7" s="&"></key>
			<key n="8" s="*"></key>
			<key n="9" s="("></key>
			<key n="0" s=")"></key>
			<key n="-" s="_"></key>
			<key n="=" s="+"></key>
			<key n="Backspace" s="Backspace" width="2"></key>
		</row>
		<row>
			<key n="Tab" s="Tab" width="1.5"></key>
			<key n="q" s="Q"></key>
			<key n="w" s="W"></key>
			<key n="e" s="E"></key>
			<key n="r" s="R"></key>
			<key n="t" s="T"></key>
			<key n="y" s="Y"></key>
			<key n="u" s="U"></key>
			<key n="i" s="i"></key>
			<key n="o" s="O"></key>
			<key n="p" s="P"></key>
			<key n="[" s="{"></key>
			<key n="]" s="}"></key>
			<key n="\\" s="|" width="1.5"></key>
		</row>
		<row>
			<key n="CapsLock" s="CapsLock" width="1.8" display="Caps Lock"></key>
			<key n="a" s="A"></key>
			<key n="s" s="S"></key>
			<key n="d" s="D"></key>
			<key n="f" s="F"></key>
			<key n="g" s="G"></key>
			<key n="h" s="H"></key>
			<key n="j" s="J"></key>
			<key n="k" s="K"></key>
			<key n="l" s="L"></key>
			<key n=";" s=":"></key>
			<key n="'" s="&quot;"></key>
			<key n="Enter" s="Enter" width="2.2"></key>
		</row>
		<row>
			<key n="Shift" s="Shift" width="2"></key>
			<key n="z" s="Z"></key>
			<key n="x" s="X"></key>
			<key n="c" s="C"></key>
			<key n="v" s="V"></key>
			<key n="b" s="B"></key>
			<key n="n" s="N"></key>
			<key n="m" s="M"></key>
			<key n="," s="&lt;"></key>
			<key n="." s="&gt;"></key>
			<key n="/" s="?"></key>
			<key n="Shift" s="Shift" width="3"></key>
		</row>
		<row>
			<key n="Control" s="Control" width="1.5" display="Ctrl"></key>
			<key n="Meta" s="Meta" width="1.5" display="Meta"></key>
			<key n="Alt" s="Alt" width="1.5" display="Alt"></key>
			<key n=" " s=" " width="6" display=" "></key>
			<key n="Alt" s="Alt" width="1.5" display="Alt"></key>
			<key n="Meta" s="Meta" width="1.5" display="Meta"></key>
			<key n="Control" s="Control" width="1.5" display="Ctrl"></key>
		</row>`;

		let shifted = false;
		let activeKeys = [];

		let fallback = (a, b) => {
			if (a == null)
				return b;
			return a;
		};

		let isActive = (key) => {
			for (let i = 0; i < activeKeys.length; i++)
			if (key == activeKeys[i])
				return true;
			return false;
		};

		let sendKeyEvent = (state, key) => {
			window.dispatchEvent(state ? new KeyboardEvent("keydown", { key: key }) : new KeyboardEvent("keyup", { key: key }));
		};

		let mapKey = (key, code) => {
			let map = this.map[code];
			if (map == null)
				return code;

			key.style.backgroundColor = "#d0d0d0";
			return map;
		};
		
		let render = () => {
			let rows = shadow.children;
			for (let i = 0; i < rows.length; i++) {
				let row = rows[i];
				let keys = row.children;
				for (let i = 0; i < keys.length; i++) {
					let key = keys[i];
					let normal = key.getAttribute("n");
					let shift = key.getAttribute("s");
					let code = shifted ? shift : normal;
					let mapped = mapKey(key, code);
					let width = fallback(key.getAttribute("width"), 1);
					let display = fallback(key.getAttribute("display"), mapped);

					if (isActive(code))
						key.setAttribute("active", "true");
					else key.removeAttribute("active");

					key.style.width = Math.round(40 * width) + "px";
					key.innerHTML = display;
					key.onmousedown = (e) => sendKeyEvent(true, code);
					key.onmouseup = (e) => sendKeyEvent(false, code);
				}
			}
		};

		Array.prototype.remove = function(element) {
			for (let i = 0; i < this.length; i++) {
				if (this[i] == element)
					this.splice(i, 1);
			}
		};

		window.addEventListener("keydown", (e) => {
			e.preventDefault();

			if (e.keyCode == 16)
				shifted = true;
			else {
				let k = e.key;
				if (!activeKeys.includes(k))
					activeKeys.push(k);
			}

			render();
			return true;
		}, false);

		window.addEventListener("keyup", (e) => {
			e.preventDefault();

			if (e.keyCode == 16)
				shifted = false;
			else activeKeys.remove(e.key);

			render();
			return true;
		}, false);

		render();

		this.render = render;
		this.shadow = shadow;
	}

	set map(_) {
		this._map = _;
		this.render();
	}

	get map() {
		let m = this._map;
		if (m == null)
			return {};
		return m;
	}
}

customElements.define("keyboard-map", HTMLKeyboardMap, {});

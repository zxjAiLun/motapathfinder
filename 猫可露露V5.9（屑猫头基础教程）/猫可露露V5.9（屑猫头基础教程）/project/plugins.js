var plugins_bb40132b_638b_4a9f_b028_d3fe47acc8d1 = 
{
    "init": function () {

	console.log("插件编写测试");

	// 可以写一些直接执行的代码
	// 在这里写的代码将会在【资源加载前】被执行，此时图片等资源尚未被加载。
	// 请勿在这里对包括bgm，图片等资源进行操作。


	this._afterLoadResources = function () {
		// 本函数将在所有资源加载完毕后，游戏开启前被执行
		// 可以在这个函数里面对资源进行一些操作，比如切分图片等。

		// 这是一个将assets.png拆分成若干个32x32像素的小图片并保存的样例。
		// var arr = core.splitImage("assets.png", 32, 32);
		// for (var i = 0; i < arr.length; i++) {
		//     core.material.images.images["asset"+i+".png"] = arr[i];
		// }	

	};

	// from 9922
	core.plugin.isEnemy = function (x, y, floorId) {
		var res = core.getBlockCls(x, y, floorId);
		return res == "enemys" || res == "enemy48";
	}

	// 主角境界文字颜色
	core.utils.setStatusBarInnerHTML = function (name, value, css) {
		if (!core.statusBar[name]) return;
		if (typeof value == 'number') value = this.formatBigNumber(value);
		// 判定是否斜体
		var italic = /^[-a-zA-Z0-9`~!@#$%^&*()_=+\[{\]}\\|;:'",<.>\/?]*$/.test(value);
		var style = 'font-style: ' + (italic ? 'italic' : 'normal') + '; ';
		// 判定是否需要缩放
		var length = this.strlen(value) || 1;
		style += 'font-size: ' + Math.min(1, 8 / length) + 'em; ';
		if (name == 'lv') {
			style += 'font-family: "楷体";';


			if (value == '大地级一阶' || value == '大地级二阶' || value == '大地级三阶' || value == '大地级四阶' || value == '大地级五阶' || value == '大地级六阶' || value == '大地级七阶' || value == '大地级八阶' || value == '大地级巅峰') {
				style += 'color: #75E97E;';
			} else if (value == '蓝海初阶' || value == '蓝海中阶' || value == '蓝海高阶') {
				style += 'color: #6FAEE4;';
			} else if (value == '蓝海巅峰' || value == '心领神会' || value == '万法集成' || value == '从心不逾' || value == '半步红海') {
				style += 'color: #357bcc;';
			} else if (value == '红海初成' || value == '红海小成' || value == '红海大成') {
				style += 'color: #C76EE7;';
			} else if (value == '红海巅峰' || value == '红海圆满' || value == '谬误纠正' || value == '空间掌控' || value == '凝血之婴' || value == '半步血海') {
				style += 'color: #B02FDF;';
			} else if (value == '血海初成' || value == '血海小成' || value == '血海大成') {
				style += 'color: #E06BBB;';
			} else if (value == '血海巅峰' || value == '血海圆满' || value == '血海大圆满') {
				style += 'color: #D930A3;';
			} else if (value == '节点开闭' || value == '定势归一' || value == '破碎星河' || value == '血道真我') {
				style += 'color: #F2EE7F;';
			} else if (value == '幻神一变' || value == '幻神二变' || value == '幻神三变') {
				style += 'color: #F2EE7F;';
			} else if (value == '幻神四变' || value == '幻神五变') {
				style += 'color: #F0EA28;';
			} else if (value == '幻神六变' || value == '幻神七变') {
				style += 'color: #ECBF6C;';
			} else if (value == '幻神八变' || value == '幻神九变') {
				style += 'color: #DC8E00;';
			} else if (value == '伪神') {
				style += 'color: #E86969;';

			} else if (value == '失落之阶' || value == '绝望之阶') {
				style += 'color: #CECECE;';

			} else if (value == '信念之阶' || value == '希望之阶') {
				style += 'color: #E7A328;';
			} else if (value == '奇迹之阶') {
				style += 'color: #DC8E00;';
			}
		}

		if (css) style += css;
		core.statusBar[name].innerHTML = "<span class='_status' style='" + style + "'>" + value + "</span>";
	};
	// 可以在任何地方（如afterXXX或自定义脚本事件）调用函数，方法为 core.plugin.xxx();
	// 从V2.6开始，插件中用this.XXX方式定义的函数也会被转发到core中，详见文档-脚本-函数的转发。
},
    "drawLight": function () {

		// 绘制灯光/漆黑层效果。调用方式 core.plugin.drawLight(...)
		// 【参数说明】
		// name：必填，要绘制到的画布名；可以是一个系统画布，或者是个自定义画布；如果不存在则创建
		// color：可选，只能是一个0~1之间的数，为不透明度的值。不填则默认为0.9。
		// lights：可选，一个数组，定义了每个独立的灯光。
		//        其中每一项是三元组 [x,y,r] x和y分别为该灯光的横纵坐标，r为该灯光的半径。
		// lightDec：可选，0到1之间，光从多少百分比才开始衰减（在此范围内保持全亮），不设置默认为0。
		//        比如lightDec为0.5代表，每个灯光部分内圈50%的范围全亮，50%以后才开始快速衰减。
		// 【调用样例】
		// core.plugin.drawLight('curtain'); // 在curtain层绘制全图不透明度0.9，等价于更改画面色调为[0,0,0,0.9]。
		// core.plugin.drawLight('ui', 0.95, [[25,11,46]]); // 在ui层绘制全图不透明度0.95，其中在(25,11)点存在一个半径为46的灯光效果。
		// core.plugin.drawLight('test', 0.2, [[25,11,46,0.1]]); // 创建一个test图层，不透明度0.2，其中在(25,11)点存在一个半径为46的灯光效果，灯光中心不透明度0.1。
		// core.plugin.drawLight('test2', 0.9, [[25,11,46],[105,121,88],[301,221,106]]); // 创建test2图层，且存在三个灯光效果，分别是中心(25,11)半径46，中心(105,121)半径88，中心(301,221)半径106。
		// core.plugin.drawLight('xxx', 0.3, [[25,11,46],[105,121,88,0.2]], 0.4); // 存在两个灯光效果，它们在内圈40%范围内保持全亮，40%后才开始衰减。
		this.drawLight = function (name, color, lights, lightDec) {

			// 清空色调层；也可以修改成其它层比如animate/weather层，或者用自己创建的canvas
			var ctx = core.getContextByName(name);
			if (ctx == null) {
				if (typeof name == 'string')
					ctx = core.createCanvas(name, 0, 0, core.__PIXELS__, core.__PIXELS__, 98);
				else return;
			}

			ctx.mozImageSmoothingEnabled = false;
			ctx.webkitImageSmoothingEnabled = false;
			ctx.msImageSmoothingEnabled = false;
			ctx.imageSmoothingEnabled = false;

			core.clearMap(name);
			// 绘制色调层，默认不透明度
			if (color == null) color = 0.9;
			ctx.fillStyle = "rgba(0,0,0," + color + ")";
			ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);

			lightDec = core.clamp(lightDec, 0, 1);

			// 绘制每个灯光效果
			ctx.globalCompositeOperation = 'destination-out';
			lights.forEach(function (light) {
				// 坐标，半径，中心不透明度
				var x = light[0],
					y = light[1],
					r = light[2];
				// 计算衰减距离
				var decDistance = parseInt(r * lightDec);
				// 正方形区域的直径和左上角坐标
				var grd = ctx.createRadialGradient(x, y, decDistance, x, y, r);
				grd.addColorStop(0, "rgba(0,0,0,1)");
				grd.addColorStop(1, "rgba(0,0,0,0)");
				ctx.beginPath();
				ctx.fillStyle = grd;
				ctx.arc(x, y, r, 0, 2 * Math.PI);
				ctx.fill();
			});
			ctx.globalCompositeOperation = 'source-over';
			// 可以在任何地方（如afterXXX或自定义脚本事件）调用函数，方法为  core.plugin.xxx();
		}
	},
    "shop": function () {
		// 【全局商店】相关的功能
		// 
		// 打开一个全局商店
		// shopId：要打开的商店id；noRoute：是否不计入录像
		this.openShop = function (shopId, noRoute) {
			var shop = core.status.shops[shopId];
			// Step 1: 检查能否打开此商店
			if (!this.canOpenShop(shopId)) {
				core.drawTip("该商店尚未开启");
				return false;
			}

			// Step 2: （如有必要）记录打开商店的脚本事件
			if (!noRoute) {
				core.status.route.push("shop:" + shopId);
			}

			// Step 3: 检查道具商店 or 公共事件
			if (shop.item) {
				if (core.openItemShop) {
					core.openItemShop(shopId);
				} else {
					core.playSound('操作失败');
					core.insertAction("道具商店插件不存在！请检查是否存在该插件！");
				}
				return;
			}
			if (shop.commonEvent) {
				core.insertCommonEvent(shop.commonEvent, shop.args);
				return;
			}

			_shouldProcessKeyUp = true;

			// Step 4: 执行标准公共商店    
			core.insertAction(this._convertShop(shop));
			return true;
		}

		////// 将一个全局商店转变成可预览的公共事件 //////
		this._convertShop = function (shop) {
			return [
				{ "type": "function", "function": "function() {core.addFlag('@temp@shop', 1);}" },
				{
					"type": "while",
					"condition": "true",
					"data": [
						// 检测能否访问该商店
						{
							"type": "if",
							"condition": "core.isShopVisited('" + shop.id + "')",
							"true": [
								// 可以访问，直接插入执行效果
								{ "type": "function", "function": "function() { core.plugin._convertShop_replaceChoices('" + shop.id + "', false) }" },
							],
							"false": [
								// 不能访问的情况下：检测能否预览
								{
									"type": "if",
									"condition": shop.disablePreview,
									"true": [
										// 不可预览，提示并退出
										{ "type": "playSound", "name": "操作失败" },
										"当前无法访问该商店！",
										{ "type": "break" },
									],
									"false": [
										// 可以预览：将商店全部内容进行替换
										{ "type": "tip", "text": "当前处于预览模式，不可购买" },
										{ "type": "function", "function": "function() { core.plugin._convertShop_replaceChoices('" + shop.id + "', true) }" },
									]
								}
							]
						}
					]
				},
				{ "type": "function", "function": "function() {core.addFlag('@temp@shop', -1);}" }
			];
		}

		this._convertShop_replaceChoices = function (shopId, previewMode) {
			var shop = core.status.shops[shopId];
			var choices = (shop.choices || []).filter(function (choice) {
				if (choice.condition == null || choice.condition == '') return true;
				try { return core.calValue(choice.condition); } catch (e) { return true; }
			}).map(function (choice) {
				var ableToBuy = core.calValue(choice.need);
				return {
					"text": choice.text,
					"icon": choice.icon,
					"color": ableToBuy && !previewMode ? choice.color : [153, 153, 153, 1],
					"action": ableToBuy && !previewMode ? [{ "type": "playSound", "name": "商店" }].concat(choice.action) : [
						{ "type": "playSound", "name": "操作失败" },
						{ "type": "tip", "text": previewMode ? "预览模式下不可购买" : "购买条件不足" }
					]
				};
			}).concat({ "text": "离开", "action": [{ "type": "playSound", "name": "取消" }, { "type": "break" }] });
			core.insertAction({ "type": "choices", "text": shop.text, "choices": choices });
		}

		/// 是否访问过某个快捷商店
		this.isShopVisited = function (id) {
			if (!core.hasFlag("__shops__")) core.setFlag("__shops__", {});
			var shops = core.getFlag("__shops__");
			if (!shops[id]) shops[id] = {};
			return shops[id].visited;
		}

		/// 当前应当显示的快捷商店列表
		this.listShopIds = function () {
			return Object.keys(core.status.shops).filter(function (id) {
				return core.isShopVisited(id) || !core.status.shops[id].mustEnable;
			});
		}

		/// 是否能够打开某个商店
		this.canOpenShop = function (id) {
			if (this.isShopVisited(id)) return true;
			var shop = core.status.shops[id];
			if (shop.item || shop.commonEvent || shop.mustEnable) return false;
			return true;
		}

		/// 启用或禁用某个快捷商店
		this.setShopVisited = function (id, visited) {
			if (!core.hasFlag("__shops__")) core.setFlag("__shops__", {});
			var shops = core.getFlag("__shops__");
			if (!shops[id]) shops[id] = {};
			if (visited) shops[id].visited = true;
			else delete shops[id].visited;
		}

		/// 能否使用快捷商店
		this.canUseQuickShop = function (id) {
			// 如果返回一个字符串，表示不能，字符串为不能使用的提示
			// 返回null代表可以使用

			// 检查当前楼层的canUseQuickShop选项是否为false
			if (core.status.thisMap.canUseQuickShop === false)
				return '当前楼层不能使用快捷商店。';
			return null;
		}

		var _shouldProcessKeyUp = true;

		/// 允许商店X键退出
		core.registerAction('keyUp', 'shops', function (keycode) {
			if (!core.status.lockControl || core.status.event.id != 'action') return false;
			if ((keycode == 13 || keycode == 32) && !_shouldProcessKeyUp) {
				_shouldProcessKeyUp = true;
				return true;
			}

			if (!core.hasFlag("@temp@shop") || core.status.event.data.type != 'choices') return false;
			var data = core.status.event.data.current;
			var choices = data.choices;
			var topIndex = core.actions._getChoicesTopIndex(choices.length);
			if (keycode == 88 || keycode == 27) { // X, ESC
				core.actions._clickAction(core.actions.HSIZE, topIndex + choices.length - 1);
				return true;
			}
			return false;
		}, 60);

		/// 允许长按空格或回车连续执行操作
		core.registerAction('keyDown', 'shops', function (keycode) {
			if (!core.status.lockControl || !core.hasFlag("@temp@shop") || core.status.event.id != 'action') return false;
			if (core.status.event.data.type != 'choices') return false;
			var data = core.status.event.data.current;
			var choices = data.choices;
			var topIndex = core.actions._getChoicesTopIndex(choices.length);
			if (keycode == 13 || keycode == 32) { // Space, Enter
				core.actions._clickAction(core.actions.HSIZE, topIndex + core.status.event.selection);
				_shouldProcessKeyUp = false;
				return true;
			}
			return false;
		}, 60);

		// 允许长按屏幕连续执行操作
		core.registerAction('longClick', 'shops', function (x, y, px, py) {
			if (!core.status.lockControl || !core.hasFlag("@temp@shop") || core.status.event.id != 'action') return false;
			if (core.status.event.data.type != 'choices') return false;
			var data = core.status.event.data.current;
			var choices = data.choices;
			var topIndex = core.actions._getChoicesTopIndex(choices.length);
			if (x >= core.actions.CHOICES_LEFT && x <= core.actions.CHOICES_RIGHT && y >= topIndex && y < topIndex + choices.length) {
				core.actions._clickAction(x, y);
				return true;
			}
			return false;
		}, 60);
	},
    "removeMap": function () {
		// 高层塔砍层插件，删除后不会存入存档，不可浏览地图也不可飞到。
		// 推荐用法：
		// 对于超高层或分区域塔，当在1区时将2区以后的地图删除；1区结束时恢复2区，进二区时删除1区地图，以此类推
		// 这样可以大幅减少存档空间，以及加快存读档速度

		// 删除楼层
		// core.removeMaps("MT1", "MT300") 删除MT1~MT300之间的全部层
		// core.removeMaps("MT10") 只删除MT10层
		this.removeMaps = function (fromId, toId) {
			toId = toId || fromId;
			var fromIndex = core.floorIds.indexOf(fromId),
				toIndex = core.floorIds.indexOf(toId);
			if (toIndex < 0) toIndex = core.floorIds.length - 1;
			flags.__visited__ = flags.__visited__ || {};
			flags.__removed__ = flags.__removed__ || [];
			flags.__disabled__ = flags.__disabled__ || {};
			flags.__leaveLoc__ = flags.__leaveLoc__ || {};
			for (var i = fromIndex; i <= toIndex; ++i) {
				var floorId = core.floorIds[i];
				if (core.status.maps[floorId].deleted) continue;
				delete flags.__visited__[floorId];
				flags.__removed__.push(floorId);
				delete flags.__disabled__[floorId];
				delete flags.__leaveLoc__[floorId];
				(core.status.autoEvents || []).forEach(function (event) {
					if (event.floorId == floorId && event.currentFloor) {
						core.autoEventExecuting(event.symbol, false);
						core.autoEventExecuted(event.symbol, false);
					}
				});
				core.status.maps[floorId].deleted = true;
				core.status.maps[floorId].canFlyTo = false;
				core.status.maps[floorId].canFlyFrom = false;
				core.status.maps[floorId].cannotViewMap = true;
			}
		}

		// 恢复楼层
		// core.resumeMaps("MT1", "MT300") 恢复MT1~MT300之间的全部层
		// core.resumeMaps("MT10") 只恢复MT10层
		this.resumeMaps = function (fromId, toId) {
			toId = toId || fromId;
			var fromIndex = core.floorIds.indexOf(fromId),
				toIndex = core.floorIds.indexOf(toId);
			if (toIndex < 0) toIndex = core.floorIds.length - 1;
			flags.__removed__ = flags.__removed__ || [];
			for (var i = fromIndex; i <= toIndex; ++i) {
				var floorId = core.floorIds[i];
				if (!core.status.maps[floorId].deleted) continue;
				flags.__removed__ = flags.__removed__.filter(function (f) { return f != floorId; });
				core.status.maps[floorId] = core.loadFloor(floorId);
			}
		}

		// 分区砍层相关
		var inAnyPartition = function (floorId) {
			var inPartition = false;
			(core.floorPartitions || []).forEach(function (floor) {
				var fromIndex = core.floorIds.indexOf(floor[0]);
				var toIndex = core.floorIds.indexOf(floor[1]);
				var index = core.floorIds.indexOf(floorId);
				if (fromIndex < 0 || index < 0) return;
				if (toIndex < 0) toIndex = core.floorIds.length - 1;
				if (index >= fromIndex && index <= toIndex) inPartition = true;
			});
			return inPartition;
		}

		// 分区砍层
		this.autoRemoveMaps = function (floorId) {
			if (main.mode != 'play' || !inAnyPartition(floorId)) return;
			// 根据分区信息自动砍层与恢复
			(core.floorPartitions || []).forEach(function (floor) {
				var fromIndex = core.floorIds.indexOf(floor[0]);
				var toIndex = core.floorIds.indexOf(floor[1]);
				var index = core.floorIds.indexOf(floorId);
				if (fromIndex < 0 || index < 0) return;
				if (toIndex < 0) toIndex = core.floorIds.length - 1;
				if (index >= fromIndex && index <= toIndex) {
					core.resumeMaps(core.floorIds[fromIndex], core.floorIds[toIndex]);
				} else {
					core.removeMaps(core.floorIds[fromIndex], core.floorIds[toIndex]);
				}
			});
		}
	},
    "fiveLayers": function () {
		// 是否启用五图层（增加背景2层和前景2层） 将__enable置为true即会启用；启用后请保存后刷新编辑器
		// 背景层2将会覆盖背景层 被事件层覆盖 前景层2将会覆盖前景层
		// 另外 请注意加入两个新图层 会让大地图的性能降低一些
		// 插件作者：ad
		var __enable = true;
		if (!__enable) return;

		// 创建新图层
		function createCanvas(name, zIndex) {
			if (!name) return;
			var canvas = document.createElement('canvas');
			canvas.id = name;
			canvas.className = 'gameCanvas';
			// 编辑器模式下设置zIndex会导致加入的图层覆盖优先级过高
			if (main.mode != "editor") canvas.style.zIndex = zIndex || 0;
			// 将图层插入进游戏内容
			document.getElementById('gameDraw').appendChild(canvas);
			var ctx = canvas.getContext('2d');
			core.canvas[name] = ctx;
			canvas.width = core.__PIXELS__;
			canvas.height = core.__PIXELS__;
			return canvas;
		}

		var bg2Canvas = createCanvas('bg2', 20);
		var fg2Canvas = createCanvas('fg2', 63);
		// 大地图适配
		core.bigmap.canvas = ["bg2", "fg2", "bg", "event", "event2", "fg", "damage"];
		core.initStatus.bg2maps = {};
		core.initStatus.fg2maps = {};

		if (main.mode == 'editor') {
			/*插入编辑器的图层 不做此步新增图层无法在编辑器显示*/
			// 编辑器图层覆盖优先级 eui > efg > fg(前景层) > event2(48*32图块的事件层) > event(事件层) > bg(背景层)
			// 背景层2(bg2) 插入事件层(event)之前(即bg与event之间)
			document.getElementById('mapEdit').insertBefore(bg2Canvas, document.getElementById('event'));
			// 前景层2(fg2) 插入编辑器前景(efg)之前(即fg之后)
			document.getElementById('mapEdit').insertBefore(fg2Canvas, document.getElementById('ebm'));
			// 原本有三个图层 从4开始添加
			var num = 4;
			// 新增图层存入editor.dom中
			editor.dom.bg2c = core.canvas.bg2.canvas;
			editor.dom.bg2Ctx = core.canvas.bg2;
			editor.dom.fg2c = core.canvas.fg2.canvas;
			editor.dom.fg2Ctx = core.canvas.fg2;
			editor.dom.maps.push('bg2map', 'fg2map');
			editor.dom.canvas.push('bg2', 'fg2');

			// 创建编辑器上的按钮
			var createCanvasBtn = function (name) {
				// 电脑端创建按钮
				var input = document.createElement('input');
				// layerMod4/layerMod5
				var id = 'layerMod' + num++;
				// bg2map/fg2map
				var value = name + 'map';
				input.type = 'radio';
				input.name = 'layerMod';
				input.id = id;
				input.value = value;
				editor.dom[id] = input;
				input.onchange = function () {
					editor.uifunctions.setLayerMod(value);
				}
				return input;
			};

			var createCanvasBtn_mobile = function (name) {
				// 手机端往选择列表中添加子选项
				var input = document.createElement('option');
				var id = 'layerMod' + num++;
				var value = name + 'map';
				input.name = 'layerMod';
				input.value = value;
				editor.dom[id] = input;
				return input;
			};
			if (!editor.isMobile) {
				var input = createCanvasBtn('bg2');
				var input2 = createCanvasBtn('fg2');
				// 获取事件层及其父节点
				var child = document.getElementById('layerMod'),
					parent = child.parentNode;
				// 背景层2插入事件层前
				parent.insertBefore(input, child);
				// 不能直接更改背景层2的innerText 所以创建文本节点
				var txt = document.createTextNode('bg2');
				// 插入事件层前(即新插入的背景层2前)
				parent.insertBefore(txt, child);
				// 向最后插入前景层2(即插入前景层后)
				parent.appendChild(input2);
				var txt2 = document.createTextNode('fg2');
				parent.appendChild(txt2);
				parent.childNodes[2].replaceWith("bg");
				parent.childNodes[6].replaceWith("事件");
				parent.childNodes[8].replaceWith("fg");
			} else {
				var input = createCanvasBtn_mobile('bg2');
				var input2 = createCanvasBtn_mobile('fg2');
				// 手机端因为是选项 所以可以直接改innerText
				input.innerText = '背景层2';
				input2.innerText = '前景层2';
				var parent = document.getElementById('layerMod');
				parent.insertBefore(input, parent.children[1]);
				parent.appendChild(input2);
			}
		}

		var _loadFloor_doNotCopy = core.maps._loadFloor_doNotCopy;
		core.maps._loadFloor_doNotCopy = function () {
			return ["bg2map", "fg2map"].concat(_loadFloor_doNotCopy());
		}
		////// 绘制背景和前景层 //////
		core.maps._drawBg_draw = function (floorId, toDrawCtx, cacheCtx, config) {
			config.ctx = cacheCtx;
			core.maps._drawBg_drawBackground(floorId, config);
			// ------ 调整这两行的顺序来控制是先绘制贴图还是先绘制背景图块；后绘制的覆盖先绘制的。
			core.maps._drawFloorImages(floorId, config.ctx, 'bg', null, null, config.onMap);
			core.maps._drawBgFgMap(floorId, 'bg', config);
			if (config.onMap) {
				core.drawImage(toDrawCtx, cacheCtx.canvas, core.bigmap.v2 ? -32 : 0, core.bigmap.v2 ? -32 : 0);
				core.clearMap('bg2');
				core.clearMap(cacheCtx);
			}
			core.maps._drawBgFgMap(floorId, 'bg2', config);
			if (config.onMap) core.drawImage('bg2', cacheCtx.canvas, core.bigmap.v2 ? -32 : 0, core.bigmap.v2 ? -32 : 0);
			config.ctx = toDrawCtx;
		}
		core.maps._drawFg_draw = function (floorId, toDrawCtx, cacheCtx, config) {
			config.ctx = cacheCtx;
			// ------ 调整这两行的顺序来控制是先绘制贴图还是先绘制前景图块；后绘制的覆盖先绘制的。
			core.maps._drawFloorImages(floorId, config.ctx, 'fg', null, null, config.onMap);
			core.maps._drawBgFgMap(floorId, 'fg', config);
			if (config.onMap) {
				core.drawImage(toDrawCtx, cacheCtx.canvas, core.bigmap.v2 ? -32 : 0, core.bigmap.v2 ? -32 : 0);
				core.clearMap('fg2');
				core.clearMap(cacheCtx);
			}
			core.maps._drawBgFgMap(floorId, 'fg2', config);
			if (config.onMap) core.drawImage('fg2', cacheCtx.canvas, core.bigmap.v2 ? -32 : 0, core.bigmap.v2 ? -32 : 0);
			config.ctx = toDrawCtx;
		}
		////// 移动判定 //////
		core.maps._generateMovableArray_arrays = function (floorId) {
			return {
				bgArray: this.getBgMapArray(floorId),
				fgArray: this.getFgMapArray(floorId),
				eventArray: this.getMapArray(floorId),
				bg2Array: this._getBgFgMapArray('bg2', floorId),
				fg2Array: this._getBgFgMapArray('fg2', floorId)
			};
		}
	},
    "itemShop": function () {
	// 道具商店相关的插件
	// 可在全塔属性-全局商店中使用「道具商店」事件块进行编辑（如果找不到可以在入口方块中找）

	var shopId = null; // 当前商店ID
	var type = 0; // 当前正在选中的类型，0买入1卖出
	var selectItem = 0; // 当前正在选中的道具
	var selectCount = 0; // 当前已经选中的数量
	var page = 0;
	var totalPage = 0;
	var totalMoney = 0;
	var list = [];
	var shopInfo = null; // 商店信息
	var choices = []; // 商店选项
	var use = 'money';
	var useText = '领悟';

	var bigFont = core.ui._buildFont(20, false),
		middleFont = core.ui._buildFont(18, false);

	this._drawItemShop = function () {
		// 绘制道具商店

		// Step 1: 背景和固定的几个文字
		core.ui._createUIEvent();
		core.clearMap('uievent');
		core.ui.clearUIEventSelector();
		core.setTextAlign('uievent', 'left');
		core.setTextBaseline('uievent', 'top');
		core.fillRect('uievent', 0, 0, 416, 416, 'black');
		core.drawWindowSkin('winskin.png', 'uievent', 0, 0, 416, 56);
		core.drawWindowSkin('winskin.png', 'uievent', 0, 56, 312, 56);
		core.drawWindowSkin('winskin.png', 'uievent', 0, 112, 312, 304);
		core.drawWindowSkin('winskin.png', 'uievent', 312, 56, 104, 56);
		core.drawWindowSkin('winskin.png', 'uievent', 312, 112, 104, 304);
		core.setFillStyle('uievent', 'white');
		core.setStrokeStyle('uievent', 'white');
		core.fillText("uievent", "购买", 32, 74, 'white', bigFont);
		core.fillText("uievent", "卖出", 132, 74);
		core.fillText("uievent", "离开", 232, 74);
		core.fillText("uievent", "当前" + useText, 324, 66, null, middleFont);
		core.setTextAlign("uievent", "right");
		core.fillText("uievent", core.formatBigNumber(core.status.hero[use]), 405, 89);
		core.setTextAlign("uievent", "left");
		core.ui.drawUIEventSelector(1, "winskin.png", 22 + 100 * type, 66, 60, 33);
		if (selectItem != null) {
			core.setTextAlign('uievent', 'center');
			core.fillText("uievent", type == 0 ? "买入个数" : "卖出个数", 364, 320, null, bigFont);
			core.fillText("uievent", "<   " + selectCount + "   >", 364, 350);
			core.fillText("uievent", "确定", 364, 380);
		}

		// Step 2：获得列表并展示
		list = choices.filter(function (one) {
			if (one.condition != null && one.condition != '') {
				try { if (!core.calValue(one.condition)) return false; } catch (e) {}
			}
			return (type == 0 && one.money != null) || (type == 1 && one.sell != null);
		});
		var per_page = 6;
		totalPage = Math.ceil(list.length / per_page);
		page = Math.floor((selectItem || 0) / per_page) + 1;

		// 绘制分页
		if (totalPage > 1) {
			var half = 156;
			core.setTextAlign('uievent', 'center');
			core.fillText('uievent', page + " / " + totalPage, half, 388, null, middleFont);
			if (page > 1) core.fillText('uievent', '上一页', half - 80, 388);
			if (page < totalPage) core.fillText('uievent', '下一页', half + 80, 388);
		}
		core.setTextAlign('uievent', 'left');

		// 绘制每一项
		var start = (page - 1) * per_page;
		for (var i = 0; i < per_page; ++i) {
			var curr = start + i;
			if (curr >= list.length) break;
			var item = list[curr];
			core.drawIcon('uievent', item.id, 8, 125 + i * 40);
			core.setTextAlign('uievent', 'left');
			core.fillText('uievent', core.material.items[item.id].name, 44, 132 + i * 40, null, bigFont);
			core.setTextAlign('uievent', 'right');
			core.fillText('uievent', (type == 0 ? core.calValue(item.money) : core.calValue(item.sell)), 300, 133 + i * 40, null, middleFont);
			core.setTextAlign("uievent", "left");
			if (curr == selectItem) {
				// 绘制描述，文字自动放缩
				var text = core.material.items[item.id].text || "该道具暂无描述";
				try { text = core.replaceText(text); } catch (e) {}
				for (var fontSize = 20; fontSize >= 8; fontSize -= 2) {
					var config = { left: 10, fontSize: fontSize, maxWidth: 403 };
					var height = core.getTextContentHeight(text, config);
					if (height <= 50) {
						config.top = (56 - height) / 2;
						core.drawTextContent("uievent", text, config);
						break;
					}
				}
				core.ui.drawUIEventSelector(2, "winskin.png", 8, 120 + i * 40, 295, 40);
				if (type == 0 && item.number != null) {
					core.fillText("uievent", "存货", 324, 132, null, bigFont);
					core.setTextAlign("uievent", "right");
					core.fillText("uievent", item.number, 406, 132, null, null, 40);
				} else if (type == 1) {
					core.fillText("uievent", "数量", 324, 132, null, bigFont);
					core.setTextAlign("uievent", "right");
					core.fillText("uievent", core.itemCount(item.id), 406, 132, null, null, 40);
				}
				core.setTextAlign("uievent", "left");
				core.fillText("uievent", "预计" + useText, 324, 250);
				core.setTextAlign("uievent", "right");
				totalMoney = selectCount * (type == 0 ? core.calValue(item.money) : core.calValue(item.sell));
				core.fillText("uievent", core.formatBigNumber(totalMoney), 405, 280);

				core.setTextAlign("uievent", "left");
				core.fillText("uievent", type == 0 ? "已购次数" : "已卖次数", 324, 170);
				core.setTextAlign("uievent", "right");
				core.fillText("uievent", (type == 0 ? item.money_count : item.sell_count) || 0, 405, 200);
			}
		}

		core.setTextAlign('uievent', 'left');
		core.setTextBaseline('uievent', 'alphabetic');
	}

	var _add = function (item, delta) {
		if (item == null) return;
		selectCount = core.clamp(
			selectCount + delta, 0,
			Math.min(type == 0 ? Math.floor(core.status.hero[use] / core.calValue(item.money)) : core.itemCount(item.id),
				type == 0 && item.number != null ? item.number : Number.MAX_SAFE_INTEGER)
		);
	}

	var _confirm = function (item) {
		if (item == null || selectCount == 0) return;
		if (type == 0) {
			core.status.hero[use] -= totalMoney;
			core.getItem(item.id, selectCount);
			core.stopSound();
			core.playSound('确定');
			if (item.number != null) item.number -= selectCount;
			item.money_count = (item.money_count || 0) + selectCount;
		} else {
			core.status.hero[use] += totalMoney;
			core.removeItem(item.id, selectCount);
			core.playSound('确定');
			core.drawTip("成功卖出" + selectCount + "个" + core.material.items[item.id].name, item.id);
			if (item.number != null) item.number += selectCount;
			item.sell_count = (item.sell_count || 0) + selectCount;
		}
		selectCount = 0;
	}

	this._performItemShopKeyBoard = function (keycode) {
		var item = list[selectItem] || null;
		// 键盘操作
		switch (keycode) {
		case 38: // up
			if (selectItem == null) break;
			if (selectItem == 0) selectItem = null;
			else selectItem--;
			selectCount = 0;
			break;
		case 37: // left
			if (selectItem == null) {
				if (type > 0) type--;
				break;
			}
			_add(item, -1);
			break;
		case 39: // right
			if (selectItem == null) {
				if (type < 2) type++;
				break;
			}
			_add(item, 1);
			break;
		case 40: // down
			if (selectItem == null) {
				if (list.length > 0) selectItem = 0;
				break;
			}
			if (list.length == 0) break;
			selectItem = Math.min(selectItem + 1, list.length - 1);
			selectCount = 0;
			break;
		case 13:
		case 32: // Enter/Space
			if (selectItem == null) {
				if (type == 2)
					core.insertAction({ "type": "break" });
				else if (list.length > 0)
					selectItem = 0;
				break;
			}
			_confirm(item);
			break;
		case 27: // ESC
			if (selectItem == null) {
				core.insertAction({ "type": "break" });
				break;
			}
			selectItem = null;
			break;
		}
	}

	this._performItemShopClick = function (px, py) {
		var item = list[selectItem] || null;
		// 鼠标操作
		if (px >= 22 && px <= 82 && py >= 71 && py <= 102) {
			// 买
			if (type != 0) {
				type = 0;
				selectItem = null;
				selectCount = 0;
			}
			return;
		}
		if (px >= 122 && px <= 182 && py >= 71 && py <= 102) {
			// 卖
			if (type != 1) {
				type = 1;
				selectItem = null;
				selectCount = 0;
			}
			return;
		}
		if (px >= 222 && px <= 282 && py >= 71 && py <= 102) // 离开
			return core.insertAction({ "type": "break" });
		// < >
		if (px >= 318 && px <= 341 && py >= 348 && py <= 376)
			return _add(item, -1);
		if (px >= 388 && px <= 416 && py >= 348 && py <= 376)
			return _add(item, 1);
		// 确定
		if (px >= 341 && px <= 387 && py >= 380 && py <= 407)
			return _confirm(item);

		// 上一页/下一页
		if (px >= 45 && px <= 105 && py >= 388) {
			if (page > 1) {
				selectItem -= 6;
				selectCount = 0;
			}
			return;
		}
		if (px >= 208 && px <= 268 && py >= 388) {
			if (page < totalPage) {
				selectItem = Math.min(selectItem + 6, list.length - 1);
				selectCount = 0;
			}
			return;
		}

		// 实际区域
		if (px >= 9 && px <= 300 && py >= 120 && py < 360) {
			if (list.length == 0) return;
			var index = parseInt((py - 120) / 40);
			var newItem = 6 * (page - 1) + index;
			if (newItem >= list.length) newItem = list.length - 1;
			if (newItem != selectItem) {
				selectItem = newItem;
				selectCount = 0;
			}
			return;
		}
	}

	this._performItemShopAction = function () {
		if (flags.type == 0) return this._performItemShopKeyBoard(flags.keycode);
		else return this._performItemShopClick(flags.px, flags.py);
	}

	this.openItemShop = function (itemShopId) {
		shopId = itemShopId;
		type = 0;
		page = 0;
		selectItem = null;
		selectCount = 0;
		core.isShopVisited(itemShopId);
		shopInfo = flags.__shops__[shopId];
		if (shopInfo.choices == null) shopInfo.choices = core.clone(core.status.shops[shopId].choices);
		choices = shopInfo.choices;
		use = core.status.shops[shopId].use;
		if (use != 'exp') use = 'money';
		useText = use == 'money' ? '领悟' : '经验';

		core.insertAction([{
				"type": "while",
				"condition": "true",
				"data": [
					{ "type": "function", "function": "function () { core.plugin._drawItemShop(); }" },
					{ "type": "wait" },
					{ "type": "function", "function": "function() { core.plugin._performItemShopAction(); }" }
				]
			},
			{
				"type": "function",
				"function": "function () { core.deleteCanvas('uievent'); core.ui.clearUIEventSelector(); }"
			}
		]);
	}

},
    "enemyLevel": function () {
	// 此插件将提供怪物手册中的怪物境界显示
	// 使用此插件需要先给每个怪物定义境界，方法如下：
	// 点击怪物的【配置表格】，找到“【怪物】相关的表格配置”，然后在【名称】仿照增加境界定义：
	/*
	 "level": {
		  "_leaf": true,
		  "_type": "textarea",
		  "_string": true,
		  "_data": "境界"
	 },
	 */
	// 然后保存刷新，可以看到怪物的属性定义中出现了【境界】。再开启本插件即可。

	// 是否开启本插件，默认禁用；将此改成 true 将启用本插件。
	var __enable = true;
	if (!__enable) return;

	// 这里定义每个境界的显示颜色；可以写'red', '#RRGGBB' 或者[r,g,b,a]四元数组
	var levelToColors = {
		"大地级一阶": "#75E97E",
		"大地级二阶": "#75E97E",
		"大地级三阶": "#75E97E",
		"大地级四阶": "#75E97E",
		"大地级五阶": "#75E97E",
		"大地级六阶": "#75E97E",
		"大地级七阶": "#75E97E",
		"大地级八阶": "#75E97E",
		"大地级巅峰": "#75E97E",
		"天空级一阶": "#6FAEE4",
		"天空级二阶": "#6FAEE4",
		"天空级三阶": "#6FAEE4",
		"天空级四阶": "#6FAEE4",
		"天空级五阶": "#6FAEE4",
		"天空级六阶": "#6FAEE4",
		"天空级七阶": "#6FAEE4",
		"天空级八阶": "#6FAEE4",
		"天空级巅峰": "#6FAEE4",
		"云霄级一阶": "#C76EE7",
		"云霄级二阶": "#C76EE7",
		"云霄级三阶": "#C76EE7",
		"云霄级四阶": "#C76EE7",
		"云霄级五阶": "#C76EE7",
		"云霄级六阶": "#C76EE7",
		"云霄级七阶": "#C76EE7",
		"云霄级八阶": "#C76EE7",
		"云霄级巅峰": "#C76EE7",
		"领域级一阶": "#E06BBB",
		"领域级二阶": "#E06BBB",
		"领域级三阶": "#E06BBB",
		"领域级四阶": "#E06BBB",
		"领域级五阶": "#E06BBB",
		"领域级六阶": "#E06BBB",
		"领域级七阶": "#E06BBB",
		"领域级八阶": "#E06BBB",
		"领域级巅峰": "#E06BBB",
		"世界级一阶": "#F0EA28",
		"世界级二阶": "#F0EA28",
		"世界级三阶": "#F0EA28",
		"世界级四阶": "#F0EA28",
		"世界级五阶": "#F0EA28",
		"世界级六阶": "#F0EA28",
		"世界级七阶": "#F0EA28",
		"世界级八阶": "#F0EA28",
		"世界级巅峰": "#F0EA28",
		"不朽神灵": "#EA4444",
		"不朽神侯": "#EA4444",
		"不朽神帝": "#EA4444",
		"古老存在": "#AEAFAF",
		"古老至高神": "#333333",

		//不朽、古老存在阶位
		"地神": "#EA4444", //不朽军主
		"天神": "#EA4444",
		"主神": "#EA4444",
		"域神": "#EA4444",
		"界神": "#EA4444",
		"初等": "#EA4444", //封侯、封王初等
		"高等": "#EA4444", //封侯、封王高等
		"巅峰": "#EA4444", //封侯、封王巅峰		
		"极限": "#EA4444", //封王极限
		"无敌": "#EA4444", //封王无敌
		"上古": "#AEAFAF", //初等尊者
		"远古": "#AEAFAF", //中等尊者
		"太古": "#AEAFAF", //高等尊者
		"亘古": "#AEAFAF", //宇宙霸主

		//幻音世界
		"聆语歌姬": "#75E97E",
		"织音歌姬": "#75E97E",
		"捕梦歌姬": "#75E97E",

		"契机音灵": "#6FAEE4",
		"形影音灵": "#6FAEE4",
		"天籁音灵": "#6FAEE4",

		"律之一转": "#C76EE7",
		"律之二转": "#C76EE7",
		"律之三转": "#C76EE7",
		"律之四转": "#C76EE7",
		"律之五转": "#C76EE7",
		"律之六转": "#C76EE7",
		"律之七转": "#C76EE7",
		"律之八转": "#C76EE7",
		"律之极限": "#C76EE7",

		" 域之『起源』": "#E06BBB",
		" 域之『融合』": "#E06BBB",
		" 域之『共鸣』": "#E06BBB",
		" 域之『畸变』": "#E06BBB",
		"域之『永谐弦』": "#E06BBB",

		" 界之『天启』": "#F0EA28",
		" 界之『流转』": "#F0EA28",
		" 界之『华韵』": "#F0EA28",
		" 界之『幻生』": "#F0EA28",
		"界之『极壁者』": "#F0EA28",

	};





	// 复写 _drawBook_drawName
	var originDrawBook = core.ui._drawBook_drawName;
	core.ui._drawBook_drawName = function (index, enemy, top, left, width) {
		// 如果没有境界，则直接调用原始代码绘制
		if (!enemy.level) return originDrawBook.call(core.ui, index, enemy, top, left, width);
		// 存在境界，则额外进行绘制
		core.setTextAlign('ui', 'center');
		if (enemy.specialText.length == 0) {
			if (!enemy.lv2) {
				core.fillText('ui', enemy.name, left + width / 2,
					top + 27, '#DDDDDD', this._buildFont(17, true));
				core.fillText('ui', enemy.level, left + width / 2,
					top + 51, core.arrayToRGBA(levelToColors[enemy.level] || '#DDDDDD'), this._buildFont(14, true));
			} else {
				core.fillText('ui', enemy.name, left + width / 2,
					top + 22, '#DDDDDD', this._buildFont(17, true));
				core.fillText('ui', enemy.level, left + width / 2,
					top + 55, core.arrayToRGBA(levelToColors[enemy.level] || '#DDDDDD'), this._buildFont(14, true));
				core.fillText('ui', enemy.lv2, left + width / 2,
					top + 38, core.arrayToRGBA(levelToColors[enemy.lv2] || '#DDDDDD'), this._buildFont(12, true));
			}


		} else {
			if (!enemy.lv2) {
				core.fillText('ui', enemy.name, left + width / 2,
					top + 20, '#DDDDDD', this._buildFont(17, true), width);
			} else {
				core.fillText('ui', enemy.name, left + width / 2,
					top + 17, '#DDDDDD', this._buildFont(17, true), width);
			}




			switch (enemy.specialText.length) {
			case 1:
				if (!enemy.lv2) {
					core.fillText('ui', enemy.specialText[0], left + width / 2,
						top + 38, core.arrayToRGBA((enemy.specialColor || [])[0] || '#FF6A6A'),
						this._buildFont(14, true), width);
				} else {
					core.fillText('ui', enemy.specialText[0], left + width / 2,
						top + 33, core.arrayToRGBA((enemy.specialColor || [])[0] || '#FF6A6A'),
						this._buildFont(14, true), width);
				}

				break;
			case 2:
				// Step 1: 计算字体
				var text = enemy.specialText[0] + "  " + enemy.specialText[1];
				core.setFontForMaxWidth('ui', text, width, this._buildFont(14, true));
				// Step 2: 计算总宽度
				var totalWidth = core.calWidth('ui', text);
				var leftWidth = core.calWidth('ui', enemy.specialText[0]);
				var rightWidth = core.calWidth('ui', enemy.specialText[1]);
				// Step 3: 绘制
				if (!enemy.lv2) {
					core.fillText('ui', enemy.specialText[0], left + (width + leftWidth - totalWidth) / 2,
						top + 38, core.arrayToRGBA((enemy.specialColor || [])[0] || '#FF6A6A'));
					core.fillText('ui', enemy.specialText[1], left + (width + totalWidth - rightWidth) / 2,
						top + 38, core.arrayToRGBA((enemy.specialColor || [])[1] || '#FF6A6A'));
				} else {
					core.fillText('ui', enemy.specialText[0], left + (width + leftWidth - totalWidth) / 2,
						top + 32, core.arrayToRGBA((enemy.specialColor || [])[0] || '#FF6A6A'));
					core.fillText('ui', enemy.specialText[1], left + (width + totalWidth - rightWidth) / 2,
						top + 32, core.arrayToRGBA((enemy.specialColor || [])[1] || '#FF6A6A'));
				}

				break;
			default:
				if (!enemy.lv2) {
					core.fillText('ui', '多属性...', left + width / 2,
						top + 38, '#FF6A6A', this._buildFont(14, true), width);
				} else {
					core.fillText('ui', '多属性...', left + width / 2,
						top + 32, '#FF6A6A', this._buildFont(14, true), width);
				}

			}

			if (!enemy.lv2) {
				core.fillText('ui', enemy.level, left + width / 2,
					top + 56, core.arrayToRGBA(levelToColors[enemy.level] || '#DDDDDD'), this._buildFont(14, true));
			} else {
				core.fillText('ui', enemy.level, left + width / 2,
					top + 59, core.arrayToRGBA(levelToColors[enemy.level] || '#DDDDDD'), this._buildFont(14, true));
				core.fillText('ui', enemy.lv2, left + width / 2,
					top + 45, core.arrayToRGBA(levelToColors[enemy.lv2] || '#DDDDDD'), this._buildFont(12, true));
			}


		}
	}

	// 也可以复写其他的属性颜色如怪物攻防等，具体参见下面的例子的注释部分
	core.ui._drawBook_drawRow1 = function (index, enemy, top, left, width, position) {
		// 绘制第一行
		core.setTextAlign('ui', 'left');
		var b13 = this._buildFont(13, true),
			f13 = this._buildFont(13, false);
		var col1 = left,
			col2 = left + width * 9 / 25,
			col3 = left + width * 17 / 25;
		core.fillText('ui', '生命', col1, position, '#DDDDDD', f13);
		core.fillText('ui', core.formatBigNumber(enemy.hp || 0), col1 + 30, position, /*'red' */ null, b13);
		core.fillText('ui', '攻击', col2, position, null, f13);
		core.fillText('ui', core.formatBigNumber(enemy.atk || 0), col2 + 30, position, /* '#FF0000' */ null, b13);
		core.fillText('ui', '防御', col3, position, null, f13);
		core.fillText('ui', core.formatBigNumber(enemy.def || 0), col3 + 30, position, /* [255, 0, 0, 1] */ null, b13);
	}


},
    "dynamicHp": function () {
	// 此插件允许人物血量动态进行变化
	// 原作：Fux2（老黄鸡）

	// 是否开启本插件，默认禁用；将此改成 true 将启用本插件。
	var __enable = false;
	if (!__enable) return;

	var speed = 0.05; // 动态血量变化速度，越大越快。

	var _currentHp = null;
	var _lastStatus = null;
	var _check = function () {
		if (_lastStatus != core.status.hero) {
			_lastStatus = core.status.hero;
			_currentHp = core.status.hero.hp;
		}
	}

	core.registerAnimationFrame('dynamicHp', true, function () {
		_check();
		if (core.status.hero.hp != _currentHp) {
			var dis = (_currentHp - core.status.hero.hp) * speed;
			if (Math.abs(dis) < 2) {
				_currentHp = core.status.hero.hp;
			} else {
				_currentHp -= dis;
			}
			core.setStatusBarInnerHTML('hp', _currentHp);
		}
	});
},
    "multiHeros": function () {
		// 多角色插件
		// Step 1: 启用本插件
		// Step 2: 定义每个新的角色各项初始数据（参见下方注释）
		// Step 3: 在游戏中的任何地方都可以调用 `core.changeHero()` 进行切换；也可以 `core.changeHero(1)` 来切换到某个具体的角色上

		// 是否开启本插件，默认禁用；将此改成 true 将启用本插件。
		var __enable = false;
		if (!__enable) return;

		// 在这里定义全部的新角色属性
		// 请注意，在这里定义的内容不会多角色共用，在切换时会进行恢复。
		// 你也可以自行新增或删除，比如不共用金币则可以加上"money"的初始化，不共用道具则可以加上"items"的初始化，
		// 多角色共用hp的话则删除hp，等等。总之，不共用的属性都在这里进行定义就好。
		var hero1 = {
			"floorId": "MT0", // 该角色初始楼层ID；如果共用楼层可以注释此项
			"image": "brave.png", // 角色的行走图名称；此项必填不然会报错
			"name": "1号角色",
			"lv": 1,
			"hp": 10000, // 如果HP共用可注释此项
			"atk": 1000,
			"def": 1000,
			"mdef": 0,
			// "money": 0, // 如果要不共用金币则取消此项注释
			// "exp": 0, // 如果要不共用经验则取消此项注释
			"loc": { "x": 0, "y": 0, "direction": "up" }, // 该角色初始位置；如果共用位置可注释此项
			"items": {
				"tools": {}, // 如果共用消耗道具（含钥匙）则可注释此项
				// "constants": {}, // 如果不共用永久道具（如手册）可取消注释此项
				"equips": {}, // 如果共用在背包的装备可注释此项
			},
			"equipment": [], // 如果共用装备可注释此项；此项和上面的「共用在背包的装备」需要拥有相同状态，不然可能出现问题
		};
		// 也可以类似新增其他角色
		// 新增的角色，各项属性共用与不共用的选择必须和上面完全相同，否则可能出现问题。
		// var hero2 = { ...

		var heroCount = 2; // 包含默认角色在内总共多少个角色，该值需手动修改。

		this.initHeros = function () {
			core.setFlag("hero1", core.clone(hero1)); // 将属性值存到变量中
			// core.setFlag("hero2", core.clone(hero2)); // 更多的角色也存入变量中；每个定义的角色都需要新增一行

			// 检测是否存在装备
			if (hero1.equipment) {
				if (!hero1.items || !hero1.items.equips) {
					alert('多角色插件的equipment和道具中的equips必须拥有相同状态！');
				}
				// 存99号套装为全空
				var saveEquips = core.getFlag("saveEquips", []);
				saveEquips[99] = [];
				core.setFlag("saveEquips", saveEquips);
			} else {
				if (hero1.items && hero1.items.equips) {
					alert('多角色插件的equipment和道具中的equips必须拥有相同状态！');
				}
			}
		}

		// 在游戏开始注入initHeros
		var _startGame_setHard = core.events._startGame_setHard;
		core.events._startGame_setHard = function () {
			_startGame_setHard.call(core.events);
			core.initHeros();
		}

		// 切换角色
		// 可以使用 core.changeHero() 来切换到下一个角色
		// 也可以 core.changeHero(1) 来切换到某个角色（默认角色为0）
		this.changeHero = function (toHeroId) {
			var currHeroId = core.getFlag("heroId", 0); // 获得当前角色ID
			if (toHeroId == null) {
				toHeroId = (currHeroId + 1) % heroCount;
			}
			if (currHeroId == toHeroId) return;

			var saveList = Object.keys(hero1);

			// 保存当前内容
			var toSave = {};
			// 暂时干掉 drawTip 和 音效，避免切装时的提示
			var _drawTip = core.ui.drawTip;
			core.ui.drawTip = function () { };
			var _playSound = core.control.playSound;
			core.control.playSound = function () { }
			// 记录当前录像，因为可能存在换装问题
			core.clearRouteFolding();
			var routeLength = core.status.route.length;
			// 优先判定装备
			if (hero1.equipment) {
				core.items.quickSaveEquip(100 + currHeroId);
				core.items.quickLoadEquip(99);
			}

			saveList.forEach(function (name) {
				if (name == 'floorId') toSave[name] = core.status.floorId; // 楼层单独设置
				else if (name == 'items') {
					toSave.items = core.clone(core.status.hero.items);
					Object.keys(toSave.items).forEach(function (one) {
						if (!hero1.items[one]) delete toSave.items[one];
					});
				} else toSave[name] = core.clone(core.status.hero[name]); // 使用core.clone()来创建新对象
			});

			core.setFlag("hero" + currHeroId, toSave); // 将当前角色信息进行保存
			var data = core.getFlag("hero" + toHeroId); // 获得要切换的角色保存内容

			// 设置角色的属性值
			saveList.forEach(function (name) {
				if (name == "floorId");
				else if (name == "items") {
					Object.keys(core.status.hero.items).forEach(function (one) {
						if (data.items[one]) core.status.hero.items[one] = core.clone(data.items[one]);
					});
				} else {
					core.status.hero[name] = core.clone(data[name]);
				}
			});
			// 最后装上装备
			if (hero1.equipment) {
				core.items.quickLoadEquip(100 + toHeroId);
			}

			core.ui.drawTip = _drawTip;
			core.control.playSound = _playSound;
			core.status.route = core.status.route.slice(0, routeLength);
			core.control._bindRoutePush();

			// 插入事件：改变角色行走图并进行楼层切换
			var toFloorId = data.floorId || core.status.floorId;
			var toLoc = data.loc || core.status.hero.loc;
			core.insertAction([
				{ "type": "setHeroIcon", "name": data.image || "hero.png" }, // 改变行走图
				// 同层则用changePos，不同层则用changeFloor；这是为了避免共用楼层造成触发eachArrive
				toFloorId != core.status.floorId ? {
					"type": "changeFloor",
					"floorId": toFloorId,
					"loc": [toLoc.x, toLoc.y],
					"direction": toLoc.direction,
					"time": 0 // 可以在这里设置切换时间
				} : { "type": "changePos", "loc": [toLoc.x, toLoc.y], "direction": toLoc.direction }
				// 你还可以在这里执行其他事件，比如增加或取消跟随效果
			]);
			core.setFlag("heroId", toHeroId); // 保存切换到的角色ID
		}
	},
    "itemCategory": function () {
	// 物品分类插件。此插件允许你对消耗道具和永久道具进行分类，比如标记「宝物类」「剧情道具」「药品」等等。
	// 使用方法：
	// 1. 启用本插件
	// 2. 在下方数组中定义全部的物品分类类型
	// 3. 点击道具的【配置表格】，找到“【道具】相关的表格配置”，然后在【道具描述】之后仿照增加道具的分类：
	/*
	 "category": {
		  "_leaf": true,
		  "_type": "textarea",
		  "_string": true,
		  "_data": "道具分类"
	 },
	 */
	// （你也可以选择使用下拉框的方式定义每个道具的分类，写法参见上面的cls）
	// 然后刷新编辑器，就可以对每个物品进行分类了

	// 是否开启本插件，默认禁用；将此改成 true 将启用本插件。
	var __enable = false;
	if (!__enable) return;

	// 在这里定义所有的道具分类类型，一行一个
	var categories = [
		"宝物类",
		"辅助类",
		"技能类",
		"剧情道具",
		"增益道具",
	];
	// 当前选中的道具类别
	var currentCategory = null;

	// 重写 core.ui._drawToolbox 以绘制分类类别
	var _drawToolbox = core.ui._drawToolbox;
	core.ui._drawToolbox = function (index) {
		_drawToolbox.call(this, index);
		core.setTextAlign('ui', 'left');
		core.fillText('ui', '类别[E]：' + (currentCategory || "全部"), 15, this.PIXEL - 13);
	}

	// 获得所有应该在道具栏显示的某个类型道具
	core.ui.getToolboxItems = function (cls) {
		// 检查类别
		return Object.keys(core.status.hero.items[cls])
			.filter(function (id) {
				return !core.material.items[id].hideInToolbox &&
					(currentCategory == null || core.material.items[id].category == currentCategory);
			}).sort();
	}

	// 注入道具栏的点击事件（点击类别）
	var _clickToolbox = core.actions._clickToolbox;
	core.actions._clickToolbox = function (x, y) {
		if (x >= 0 && x <= this.HSIZE - 4 && y == this.LAST) {
			drawToolboxCategory();
			return;
		}
		return _clickToolbox.call(core.actions, x, y);
	}

	// 注入道具栏的按键事件（E键）
	var _keyUpToolbox = core.actions._keyUpToolbox;
	core.actions._keyUpToolbox = function (keyCode) {
		if (keyCode == 69) {
			// 按E键则打开分类类别选择
			drawToolboxCategory();
			return;
		}
		return _keyUpToolbox.call(core.actions, keyCode);
	}

	// ------ 以下为选择道具分类的相关代码 ------ //

	// 关闭窗口时清除分类选择项
	var _closePanel = core.ui.closePanel;
	core.ui.closePanel = function () {
		currentCategory = null;
		_closePanel.call(core.ui);
	}

	// 弹出菜单以选择具体哪个分类
	// 直接使用 core.drawChoices 进行绘制
	var drawToolboxCategory = function () {
		if (core.status.event.id != 'toolbox') return;
		var selection = categories.indexOf(currentCategory) + 1;
		core.ui.closePanel();
		core.status.event.id = 'toolbox-category';
		core.status.event.selection = selection;
		core.lockControl();
		// 给第一项插入「全部」
		core.drawChoices('请选择道具类别', ["全部"].concat(categories));
	}

	// 选择某一项
	var _selectCategory = function (index) {
		core.ui.closePanel();
		if (index <= 0 || index > categories.length) currentCategory = null;
		else currentCategory = categories[index - 1];
		core.openToolbox();
	}

	var _clickToolBoxCategory = function (x, y) {
		if (!core.status.lockControl || core.status.event.id != 'toolbox-category') return false;

		if (x < core.actions.CHOICES_LEFT || x > core.actions.CHOICES_RIGHT) return false;
		var choices = core.status.event.ui.choices;
		var topIndex = core.actions._getChoicesTopIndex(choices.length);
		if (y >= topIndex && y < topIndex + choices.length) {
			_selectCategory(y - topIndex);
		}
		return true;
	}

	// 注入点击事件
	core.registerAction('onclick', 'toolbox-category', _clickToolBoxCategory, 100);

	// 注入光标跟随事件
	core.registerAction('onmove', 'toolbox-category', function (x, y) {
		if (!core.status.lockControl || core.status.event.id != 'toolbox-category') return false;
		core.actions._onMoveChoices(x, y);
		return true;
	}, 100);

	// 注入键盘光标事件
	core.registerAction('keyDown', 'toolbox-category', function (keyCode) {
		if (!core.status.lockControl || core.status.event.id != 'toolbox-category') return false;
		core.actions._keyDownChoices(keyCode);
		return true;
	}, 100);

	// 注入键盘按键事件
	core.registerAction('keyUp', 'toolbox-category', function (keyCode) {
		if (!core.status.lockControl || core.status.event.id != 'toolbox-category') return false;
		core.actions._selectChoices(core.status.event.ui.choices.length, keyCode, _clickToolBoxCategory);
		return true;
	}, 100);

},
    "heroFourFrames": function () {
		// 样板的勇士/跟随者移动时只使用2、4两帧，观感较差。本插件可以将四帧全用上。

		// 是否启用本插件
		var __enable = false;
		if (!__enable) return;

		["up", "down", "left", "right"].forEach(function (one) {
			// 指定中间帧动画
			core.material.icons.hero[one].midFoot = 2;
		});

		var heroMoving = function (timestamp) {
			if (core.status.heroMoving <= 0) return;
			if (timestamp - core.animateFrame.moveTime > core.values.moveSpeed) {
				core.animateFrame.leftLeg++;
				core.animateFrame.moveTime = timestamp;
			}
			core.drawHero(['stop', 'leftFoot', 'midFoot', 'rightFoot'][core.animateFrame.leftLeg % 4], 4 * core.status.heroMoving);
		}
		core.registerAnimationFrame('heroMoving', true, heroMoving);

		core.events._eventMoveHero_moving = function (step, moveSteps) {
			var curr = moveSteps[0];
			var direction = curr[0], x = core.getHeroLoc('x'), y = core.getHeroLoc('y');
			// ------ 前进/后退
			var o = direction == 'backward' ? -1 : 1;
			if (direction == 'forward' || direction == 'backward') direction = core.getHeroLoc('direction');
			var faceDirection = direction;
			if (direction == 'leftup' || direction == 'leftdown') faceDirection = 'left';
			if (direction == 'rightup' || direction == 'rightdown') faceDirection = 'right';
			core.setHeroLoc('direction', direction);
			if (curr[1] <= 0) {
				core.setHeroLoc('direction', faceDirection);
				moveSteps.shift();
				return true;
			}
			if (step <= 4) core.drawHero('stop', 4 * o * step);
			else if (step <= 8) core.drawHero('leftFoot', 4 * o * step);
			else if (step <= 12) core.drawHero('midFoot', 4 * o * (step - 8));
			else if (step <= 16) core.drawHero('rightFoot', 4 * o * (step - 8)); // if (step == 8) {
			if (step == 8 || step == 16) {
				core.setHeroLoc('x', x + o * core.utils.scan2[direction].x, true);
				core.setHeroLoc('y', y + o * core.utils.scan2[direction].y, true);
				core.updateFollowers();
				curr[1]--;
				if (curr[1] <= 0) moveSteps.shift();
				core.setHeroLoc('direction', faceDirection);
				return step == 16;
			}
			return false;
		}
	},
    "startCanvas": function () {
		// 使用本插件可以将自绘的标题界面居中。仅在【标题开启事件化】后才有效。
		// 由于一些技术性的原因，标题界面事件化无法应用到覆盖状态栏的整个界面。
		// 这是一个较为妥协的插件，会在自绘标题界面时隐藏状态栏、工具栏和边框，并将画布进行居中。
		// 本插件仅在全塔属性的 "startCanvas" 生效；进入 "startText" 时将会离开居中状态，回归正常界面。

		// 是否开启本插件，默认禁用；将此改成 true 将启用本插件。
		var __enable = false;
		if (!__enable) return;

		// 检查【标题开启事件化】是否开启
		if (!core.flags.startUsingCanvas || main.mode != 'play') return;

		var _isTitleCanvasEnabled = false;
		var _getClickLoc = core.actions._getClickLoc;
		this._setTitleCanvas = function () {
			if (_isTitleCanvasEnabled) return;
			_isTitleCanvasEnabled = true;

			// 禁用窗口resize
			window.onresize = function () { };
			core.resize = function () { }

			// 隐藏状态栏
			core.dom.statusBar.style.display = 'none';
			core.dom.statusCanvas.style.display = 'none';
			core.dom.toolBar.style.display = 'none';
			// 居中画布
			if (core.domStyle.isVertical) {
				core.dom.gameDraw.style.top =
					(parseInt(core.dom.gameGroup.style.height) - parseInt(core.dom.gameDraw.style.height)) / 2 + "px";
			} else {
				core.dom.gameDraw.style.right =
					(parseInt(core.dom.gameGroup.style.width) - parseInt(core.dom.gameDraw.style.width)) / 2 + "px";
			}
			core.dom.gameDraw.style.border = '3px transparent solid';
			core.actions._getClickLoc = function (x, y) {
				var left = core.dom.gameGroup.offsetLeft + core.dom.gameDraw.offsetLeft + 3;
				var top = core.dom.gameGroup.offsetTop + core.dom.gameDraw.offsetTop + 3;
				var loc = { 'x': Math.max(x - left, 0), 'y': Math.max(y - top, 0), 'size': 32 * core.domStyle.scale };
				return loc;
			}
		}

		this._resetTitleCanvas = function () {
			if (!_isTitleCanvasEnabled) return;
			_isTitleCanvasEnabled = false;
			window.onresize = function () { try { main.core.resize(); } catch (e) { main.log(e); } }
			core.resize = function () { return core.control.resize(); }
			core.resize();
			core.actions._getClickLoc = _getClickLoc;
		}

		// 复写“开始游戏”
		core.events._startGame_start = function (hard, seed, route, callback) {
			console.log('开始游戏');
			core.resetGame(core.firstData.hero, hard, null, core.cloneArray(core.initStatus.maps));
			core.setHeroLoc('x', -1);
			core.setHeroLoc('y', -1);

			if (seed != null) {
				core.setFlag('__seed__', seed);
				core.setFlag('__rand__', seed);
			} else core.utils.__init_seed();

			core.clearStatusBar();
			core.plugin._setTitleCanvas();

			var todo = [];
			core.hideStatusBar();
			core.push(todo, core.firstData.startCanvas);
			core.push(todo, { "type": "function", "function": "function() { core.plugin._resetTitleCanvas(); core.events._startGame_setHard(); }" })
			core.push(todo, core.firstData.startText);
			this.insertAction(todo, null, null, function () {
				core.events._startGame_afterStart(callback);
			});

			if (route != null) core.startReplay(route);
		}

		var _loadData = core.control.loadData;
		core.control.loadData = function (data, callback) {
			core.plugin._resetTitleCanvas();
			_loadData.call(core.control, data, callback);
		}
	},
    "lotsofoneShowEnemyInfoWhenDown": function () {
	// 在此增加新插件
	if (main.replayChecking) return;
	// 版本控制
	if (!core.registerAnimationFrame) {
		throw new Error('require 2.6.1 or higher version');
	}

	window.Fux2 = window.Fux2 || {};
	Fux2.MorePerform = Fux2.MorePerform || {};

	Fux2.MorePerform.ShowDamagePop = {};
	Fux2.MorePerform.ShowDamagePop.version = 1.0;

	Fux2.MorePerform.ShowDamagePop.AllPopingCanvas = [];

	// 每帧的处理
	Fux2.MorePerform.ShowDamagePop.Update = function () {
		this.AllPopingCanvas = this.AllPopingCanvas.filter(function (spr) {
			spr.update();
			return spr.isAlive();
		});
		if (!this.AllPopingCanvas.length) PopSprite._count = 0;
	};

	// 弹出伤害气泡
	Fux2.MorePerform.ShowDamagePop.PopDamage = function (damageValue) {
		if (damageValue) {
			var poper = new PopSprite(core.getHeroLoc('x') * 32, core.getHeroLoc('y') * 32, damageValue);
			Fux2.MorePerform.ShowDamagePop.AllPopingCanvas.push(poper);
		}
	};

	// 战斗发生前后记录生命值并处理
	Fux2.MorePerform.ShowDamagePop.OnBattle = core.events.battle;
	core.events.battle = function () {
		var hpBeforeBattle = core.status.hero.hp;
		Fux2.MorePerform.ShowDamagePop.OnBattle.apply(core.events, arguments);
		Fux2.MorePerform.ShowDamagePop.PopDamage(Math.floor(core.status.hero.hp - hpBeforeBattle));
	};

	// 注册每帧事件
	core.registerAnimationFrame("ShowDamagePop", true, Fux2.MorePerform.ShowDamagePop.Update.bind(Fux2.MorePerform.ShowDamagePop));

	// 弹出精灵类
	function PopSprite() {
		this.initialize.apply(this, arguments);
	}

	PopSprite.prototype = Object.create(Object.prototype);
	PopSprite.prototype.constructor = PopSprite;

	// 常量
	PopSprite._count = 0;
	PopSprite._baseZOrder = 50;
	PopSprite._floorDis = 20;
	PopSprite._font = '12px 宋体';
	PopSprite._damageColor = '#FFFFFF';
	PopSprite._healColor = '#22FF44';
	PopSprite._outLineColor = '#000000';
	PopSprite._maxLife = 180;

	// 初始化
	PopSprite.prototype.initialize = function (x, y, damage) {
		this._x = x;
		this._y = y;
		this._damage = damage;
		this.initAllMembers();
		this.requestCanvas();
	};

	// 自更新
	PopSprite.prototype.update = function () {
		if (this._timer < PopSprite._maxLife) {
			this._x += this._vx;
			this._y += this._vy;
			this._vy += this._gravity;
			if (this._y >= this._floorY) {
				this._y = this._floorY;
				this._vy *= -0.75;
			}
			core.relocateCanvas(this._symbol, this._x, this._y);
			core.setOpacity(this._symbol, 1 - this._timer / PopSprite._maxLife);
		} else {
			this.dispose();
		}
		this._timer++;
	};

	// 申请并描绘canvas
	PopSprite.prototype.requestCanvas = function () {
		core.createCanvas(this._symbol, this._x, this._y, this._width, this._height, this._z);
		var canvas = core.ui.getContextByName(this._symbol);
		canvas.font = PopSprite._font;
		canvas.fillStyle = this._damage > 0 ? PopSprite._healColor : PopSprite._damageColor;
		canvas.strokeStyle = PopSprite._outLineColor;
		canvas.strokeText(this._text, 2, this._height);
		canvas.fillText(this._text, 2, this._height);
	};

	// 初始化所有成员变量
	PopSprite.prototype.initAllMembers = function () {
		this._text = String(this._damage);
		var uiContext = core.ui.getContextByName('ui');
		uiContext.font = PopSprite._font;
		var textRect = uiContext.measureText(this._text);
		this._width = Math.round(textRect.width + 4);
		this._height = 16;
		this._z = PopSprite._baseZOrder + PopSprite._count;
		this._symbol = 'popSprite' + PopSprite._count++;
		this._alive = true;
		this._vx = -2 + Math.random() * 4;
		this._vy = -3 - Math.random() * 4;
		this._gravity = 0.5;
		this._floorY = this._y + PopSprite._floorDis;
		this._timer = 0;
	};

	// 判断是否存活
	PopSprite.prototype.isAlive = function () {
		return this._alive;
	};

	// 释放
	PopSprite.prototype.dispose = function () {
		this._alive = false;
		core.deleteCanvas(this._symbol);
	};
},
    "自动拾取！": function () {
	var enable = true;
	if (!enable) return;
	// 
	// var noUpdate = false;
	////// 更新状态栏 ////// 不建议状态栏刷新后触发 容易导致录像不一致的问题
	//control.prototype.updateStatusBar = function (doNotCheckAutoEvents) {
	//	if (!core.isPlaying()) return;
	//	if (noUpdate) return;
	//	noUpdate = true;
	//	core.autoGetItem();
	//	noUpdate = false;
	//	this.controldata.updateStatusBar();
	//	if (!doNotCheckAutoEvents) core.checkAutoEvents();
	//	this._updateStatusBar_setToolboxIcon();
	//	core.clearRouteFolding();
	//}

	////// 每移动一格后执行的事件 //////
	control.prototype.moveOneStep = function (callback) {
		core.autoGetItem();
		return this.controldata.moveOneStep(callback);
	}

	function bfsFlood(sx, sy, blockfn) {
		var canMoveArray = core.generateMovableArray();
		var blocksObj = core.getMapBlocksObj();
		var bgMap = core.getBgMapArray();

		var visited = [],
			queue = [];
		visited[sx + "," + sy] = 0;
		queue.push(sx + "," + sy);

		while (queue.length > 0) {
			var now = queue.shift().split(","),
				x = ~~now[0],
				y = ~~now[1];
			for (var direction in core.utils.scan) {
				if (!core.inArray(canMoveArray[x][y], direction)) continue;
				var nx = x + core.utils.scan[direction].x,
					ny = y + core.utils.scan[direction].y,
					nindex = nx + "," + ny;
				if (visited[nindex]) continue;
				if (core.onSki(bgMap[ny][nx])) continue;
				if (blockfn && !blockfn(blocksObj, nx, ny)) continue;
				visited[nindex] = visited[now] + 1;
				queue.push(nindex);
			}
		}
	}

	function attractAnimate() {
		var name = 'attractAnimate';
		var isPlaying = false;
		this.nodes = [];

		this.add = function (id, x, y, callback) {
			this.nodes.push({ id: id, x: x, y: y, callback: callback });
		}
		this.start = function () {
			if (isPlaying) return;
			isPlaying = true;
			core.registerAnimationFrame(name, true, this.update);
			this.ctx = core.createCanvas(name, 0, 0, core.__PIXELS__, core.__PIXELS__, 120);
		}
		this.remove = function () {
			core.unregisterAnimationFrame(name);
			core.deleteCanvas(name);
			isPlaying = false;
		}
		this.clear = function () {
			this.nodes = [];
			this.remove();
		}
		var lastTime = -1;
		var self = this;
		this.update = function (timeStamp) {
			if (lastTime < 0) lastTime = timeStamp;
			if (timeStamp - lastTime < 20) return;
			lastTime = timeStamp;
			core.clearMap(name);
			var cx = core.status.heroCenter.px - 16,
				cy = core.status.heroCenter.py - 16;
			var thr = 5; //缓动比例倒数 越大移动越慢
			self.nodes.forEach(function (n) {
				var dx = cx - n.x,
					dy = cy - n.y;
				if (Math.abs(dx) <= thr && Math.abs(dy) <= thr) {
					n.dead = true;
				} else {
					n.x += ~~(dx / thr);
					n.y += ~~(dy / thr);
				}
				core.drawIcon(name, n.id, n.x, n.y, 32, 32);
			});
			self.nodes = self.nodes.filter(function (n) {
				if (n.dead && n.callback) {
					n.callback();
				}
				return !n.dead;
			});
			if (self.nodes.length == 0)
				self.remove();
		}
	}


	var animateHwnd = new attractAnimate();

	this.stopAttractAnimate = function () {
		animateHwnd.clear();
	}

	this.autoGetItem = function () {
		var canGetItems = {};
		if (!core.status.floorId || !core.status.checkBlock.damage || core.status.event.id == 'action' || core.status.lockControl) return;
		if (core.getFlag("shiqu", 0) == 0) return;
		if (Object.keys(core.status.checkBlock.damage).indexOf(core.status.hero.loc.x + "," + core.status.hero.loc.y) != -1 && core.status.checkBlock.damage[core.status.hero.loc.x + "," + core.status.hero.loc.y] >= 1) return
		if (Object.keys(core.status.checkBlock.ambush).indexOf(core.status.hero.loc.x + "," + core.status.hero.loc.y) != -1) return
		if (Object.keys(core.status.checkBlock.repulse).indexOf(core.status.hero.loc.x + "," + core.status.hero.loc.y) != -1) return

		bfsFlood(core.getHeroLoc('x'), core.getHeroLoc('y'), function (blockMap, x, y) {
			var idx = x + ',' + y;
			if (idx in canGetItems) return false;
			var blk = blockMap[idx];
			if (blk && !blk.disable && blk.event.cls == 'items' && !core.isMapBlockDisabled(core.status.floorId, blk.x, blk.y) && blk.event.trigger == 'getItem') {
				canGetItems[idx] = { x: x, y: y, id: blk.event.id };
				return !core.status.checkBlock.damage[idx] && !core.status.checkBlock.ambush[idx];
			}
			return core.maps._canMoveDirectly_checkNextPoint(blockMap, x, y);
		});
		for (var k in canGetItems) {
			var x = canGetItems[k].x,
				y = canGetItems[k].y,
				id = canGetItems[k].id;
			core.trigger(x, y);
			animateHwnd.add(id, x * 32, y * 32);
		}
		animateHwnd.start();
	}
},
    "拉票！": function () {
	// 恭喜你发现了这里！！
	// 如果是喜欢本塔的玩家，欢迎为作者投出宝贵的一票好评=w=
	// 以及加入猫群：947190984

},
    "清理怪物": function () {
	// 清怪！！
	var enable = true;
	if (!enable) return;

	///// 禁止连续瞬移合并 /////
	core.control._replayAction_moveDirectly = function (action) {
		if (action.indexOf("move:") != 0) return false;
		// 忽略连续的瞬移事件；如果大地图某一边超过计算范围则不合并
		// 		if (!core.hasFlag('poison') && core.status.thisMap.width < 2 * core.bigmap.extend + core._WIDTH_ &&
		// 			core.status.thisMap.height < 2 * core.bigmap.extend + core._HEIGHT_) {
		// 			while (core.status.replay.toReplay.length > 0 &&
		// 				core.status.replay.toReplay[0].indexOf('move:') == 0) {
		// 				core.status.route.push(action);
		// 				action = core.status.replay.toReplay.shift();
		// 			}
		// 		}

		let pos = action.substring(5).split(":");
		let x = parseInt(pos[0]),
			y = parseInt(pos[1]);
		let nowx = core.getHeroLoc('x'),
			nowy = core.getHeroLoc('y');
		let ignoreSteps = core.canMoveDirectly(x, y);
		if (!core.moveDirectly(x, y, ignoreSteps)) return false;
		if (core.status.replay.speed == 24) {
			core.replay();
			return true;
		}

		core.ui.drawArrow('ui', 32 * nowx + 16 - core.bigmap.offsetX, 32 * nowy + 16 - core.bigmap.offsetY,
			32 * x + 16 - core.bigmap.offsetX, 32 * y + 16 - core.bigmap.offsetY, '#FF0000', 3);
		let timeout = this.__replay_getTimeout();
		if (ignoreSteps < 10) timeout = timeout * ignoreSteps / 10;
		setTimeout(function () {
			core.clearMap('ui');
			core.replay();
		}, timeout);
		return true;
	}

	core.control.registerReplayAction("moveDirectly", core.control._replayAction_moveDirectly);

	////// 每移动一格后执行的事件 //////
	control.prototype.moveOneStep = function (callback) {
		core.plugin.autoGetItem();
		core.plugin.autoBattle();
		return this.controldata.moveOneStep(callback);
	}

	//////// 战斗 //////
	core.events.battle = function (id, x, y, force, callback) {
		core.saveAndStopAutomaticRoute();
		id = id || core.getBlockId(x, y);
		if (!id) return core.clearContinueAutomaticRoute(callback);
		// 非强制战斗
		if (!core.enemys.canBattle(id, x, y) && !force && !core.status.event.id) {
			core.stopSound();
			core.playSound('操作失败');
			core.drawTip("你打不过此怪物！", id);
			return core.clearContinueAutomaticRoute(callback);
		}
		// 自动清怪时禁止自动存档
		var need_save = !core.status.event.id && !core.getFlag("disable_autosave2", 0);
		// 自动存档
		if (need_save) core.autosave(true);
		// 战前事件
		if (!this.beforeBattle(id, x, y))
			return core.clearContinueAutomaticRoute(callback);
		// 战后事件
		this.afterBattle(id, x, y);
		core.setFlag("disable_autosave", 0);
		if (callback) callback();
	}

	function bfsFlood(sx, sy, blockfn) {
		var canMoveArray = core.generateMovableArray();
		var blocksObj = core.getMapBlocksObj();
		var bgMap = core.getBgMapArray();

		var visited = [],
			queue = [];
		visited[sx + "," + sy] = 0;
		queue.push(sx + "," + sy);

		while (queue.length > 0) {
			var now = queue.shift().split(","),
				x = ~~now[0],
				y = ~~now[1];
			for (var direction in core.utils.scan) {
				if (!core.inArray(canMoveArray[x][y], direction)) continue;
				var nx = x + core.utils.scan[direction].x,
					ny = y + core.utils.scan[direction].y,
					nindex = nx + "," + ny;
				if (visited[nindex]) continue;
				if (core.onSki(bgMap[ny][nx])) continue;
				if (blockfn && !blockfn(blocksObj, nx, ny)) continue;
				visited[nindex] = visited[now] + 1;
				queue.push(nindex);
			}
		}
	}

	this.isEnemy = function (x, y) {
		return core.getBlockCls(x, y) === 'enemys' || core.getBlockCls(x, y) === 'enemy48';
	}

	this.autoBattle = function () {
		if (core.getFlag("autoBattle", 0) == 0) return;
		var canBattleEnemys = {};
		var index_list = []; // 保序
		var canBattleFunc = function (block, idx, x, y) {
			var blkid = block ? block.event.id : "";
			var result = block && !block.disable && core.plugin.isEnemy(x, y) && !core.isMapBlockDisabled(core.status.floorId, block.x, block.y) &&
				block.event.trigger == 'battle';
			if (!result) return false;
			var enemy = core.material.enemys[blkid];
			if (core.getDamage(blkid, x, y) == null || core.getDamage(blkid, x, y) > 0) return false;

			// 不清
			if (core.enemys.hasSpecial(blkid, 25) || core.enemys.hasSpecial(blkid, 18) || core.enemys.hasSpecial(blkid, 85) || core.enemys.hasSpecial(blkid, 86) || core.enemys.hasSpecial(blkid, 88) || core.enemys.hasSpecial(blkid, 113) || core.enemys.hasSpecial(blkid, 114) || core.enemys.hasSpecial(blkid, 120) || core.enemys.hasSpecial(blkid, 121) || core.enemys.hasSpecial(blkid, 115) || core.enemys.hasSpecial(blkid, 116) || core.enemys.hasSpecial(blkid, 126) || core.enemys.hasSpecial(blkid, 89) || core.enemys.hasSpecial(blkid, 70) || core.enemys.hasSpecial(blkid, 67) || core.enemys.hasSpecial(blkid, 141) || core.enemys.hasSpecial(blkid, 142) || core.enemys.hasSpecial(blkid, 143) || core.enemys.hasSpecial(blkid, 145) || core.enemys.hasSpecial(blkid, 146) || core.enemys.hasSpecial(blkid, 153) || core.enemys.hasSpecial(blkid, 154) || core.enemys.hasSpecial(blkid, 156) || core.enemys.hasSpecial(blkid, 157) || core.enemys.hasSpecial(blkid, 158) || core.enemys.hasSpecial(blkid, 159) || core.enemys.hasSpecial(blkid, 26) || core.enemys.hasSpecial(blkid, 81)) return false;



			// 反光环
			//if (core.enemys.hasSpecial(blkid, 25) && (enemy.atkValue < 0 || enemy.defValue < 0 || enemy.hpValue < 0)) return false;
			//if (core.enemys.hasSpecial(blkid, 32) || core.enemys.hasSpecial(blkid, 34) ||
			//	core.enemys.hasSpecial(blkid, 35) || core.enemys.hasSpecial(blkid, 36) ||
			//	core.enemys.hasSpecial(blkid, 37) || core.enemys.hasSpecial(blkid, 38) ||
			//	core.enemys.hasSpecial(blkid, 39) || core.enemys.hasSpecial(blkid, 27) ||
			//	core.enemys.hasSpecial(blkid, 40) || core.enemys.hasSpecial(blkid, 41) ||
			//	core.enemys.hasSpecial(blkid, 55)) return false;
			return true;
		}
		var blockfn = function (blockMap, x, y) {
			var idx = x + ',' + y;
			if (idx in canBattleEnemys) return false;
			var blk = blockMap[idx];

			if (canBattleFunc(blk, idx, x, y)) {
				canBattleEnemys[idx] = { x: x, y: y, id: blk.event.id };
				index_list.push(idx);
				return !core.status.checkBlock.damage[idx] && !core.status.checkBlock.repulse[idx] && !core.status.checkBlock.ambush[idx];
			}
			return core.maps._canMoveDirectly_checkNextPoint(blockMap, x, y);
		};
		if (!core.status.floorId || !core.status.checkBlock.damage || core.status.event.id == 'action' || core.status.lockControl) return;
		// 身處地圖傷害時只能自動处理身邊的
		var near_only = false;
		var loc_x = core.status.hero.loc.x,
			loc_y = core.status.hero.loc.y,
			loc_idx = loc_x + "," + loc_y;
		if (Object.keys(core.status.checkBlock.damage).indexOf(loc_idx) != -1) near_only = true;
		if (Object.keys(core.status.checkBlock.repulse).indexOf(loc_idx) != -1) near_only = true;
		if (Object.keys(core.status.checkBlock.ambush).indexOf(loc_idx) != -1) near_only = true;

		if (near_only) {
			for (var direction in core.utils.scan) {
				var nx = loc_x + core.utils.scan[direction].x,
					ny = loc_y + core.utils.scan[direction].y,
					nindex = nx + "," + ny;
				var blk = core.getMapBlocksObj()[nindex];
				if (canBattleFunc(blk, nindex, nx, ny)) {
					canBattleEnemys[nindex] = { x: nx, y: ny, id: blk.event.id };
					index_list.push(nindex);
				}
			}
		} else {
			bfsFlood(core.getHeroLoc('x'), core.getHeroLoc('y'), blockfn);
		}
		core.setFlag("disable_autosave2", 1);
		for (var i = 0; i < index_list.length; ++i) {
			var k = index_list[i];
			var x = canBattleEnemys[k].x,
				y = canBattleEnemys[k].y,
				id = canBattleEnemys[k].id;
			if (core.plugin.isEnemy(x, y) && core.getDamage(id, x, y) <= 0) { // double check，比如打了某只暴戾之后本来0伤的怪突然非0了
				core.battle(id, x, y);
			}
		}
		core.setFlag("disable_autosave2", 0);
	}
},
    "autoBattle": function () {


},
    "warning": function () {
	// 在此增加新插件
	// 默认音效名
	var defaultSound = 'xiong.mp3';
	// 默认字体名
	var defaultFont = 'Verdana';

	var timeout;
	/** warning提示
	 * @param {number} x 横坐标
	 * @param {number} y 纵坐标
	 * @param {string} text 显示的文字
	 */
	this.drawWarning = function (x, y, text) {
		if (timeout) return;
		x = x || 6;
		y = y || 6;
		text = text || 'boss';
		text += '</br>';
		for (var i = 0; i < 10; i++) text += ' ';
		text += 'Warning！';
		// 生成文字
		var elements = document.querySelectorAll('.gameCanvas');
		var t = document.createElement('p');
		t.innerHTML = text;
		t.style.position = 'absolute';
		t.style.fontSize = '4em';
		t.style.left = -(300 * core.domStyle.scale) + 'px';
		t.style.top = (parseInt(elements[0].style.height) / 2 - 100) + 'px';
		t.style.zIndex = '300';
		t.style.color = '#f11';
		t.style.fontFamily = defaultFont;
		t.style.overflow = 'none';
		t.style.width = '100%';
		t.classList.add('warning');
		core.dom.gameDraw.appendChild(t);
		setTimeout(function () { t.style.left = (416 * core.domStyle.scale) + 'px' }, 50);
		// 计算偏移量
		var px = (6 - x) / 12 * 50;
		var py = (6 - y) / 12 * 50;
		// 修改画布的scale和transform
		elements.forEach(function (v) {
			if (v instanceof HTMLCanvasElement) {
				v.style.transform = 'scale(2)translate(' + px + '%, ' + py + '%)';
			}
		});
		core.playSound(defaultSound);
		// 拉回镜头
		timeout = setTimeout(function () {
			timeout = setTimeout(function () {
				timeout = void 0;
				core.dom.gameDraw.removeChild(t);
			}, 1500);
			elements.forEach(function (v) {
				if (v instanceof HTMLCanvasElement) {
					v.style.transform = 'none';
				}
			});
		}, 1600);
	}
},
    "enemycut": function () {

	/* 弹出显示某个内容
	 * 使用方法：core.addPop(px, py, value, color, boldColor)
	 * 参数说明:
	 * px & py: number  弹出位置
	 * value: string  显示内容
	 * color: string  填充颜色
	 * boldColor: string  描边颜色
	 */

	// 默认字体
	var fontD = '9px nake2';
	// 默认颜色
	var colorD = '#ff6868';
	// 默认描边颜色
	var boldColorD = '#0000000';
	var hs = 0;
	if (core.getHeroLoc('x') <= 6) hs = 1;
	else hs = -1;
	/** 血量弹出 */
	function pop() {
		var ctx = core.getContextByName('pop');
		if (!ctx) ctx = core.createCanvas('pop', 0, 0, core.__PIXELS__, core.__PIXELS__, 90);
		core.clearMap(ctx);
		var list = core.status.pop || [];
		if (core.isReplaying()) {
			list = [];
			core.status.pop = []
		};
		var count = 0;
		list.forEach(function (one) {

			// 由frame计算出dy
			var dy = 3 - one.frame * 0.2;
			var dx = 0;
			if (one.color == '#FF6666') dx = hs;

			if (one.frame >= 30 && one.color != '#FF6666') dx = 0, dy = 0;
			one.py -= dy;
			one.px += dx;
			one.frame++;
			// 绘制
			if (one.frame >= 60) core.setAlpha(ctx, 3 - one.frame / 30);
			else core.setAlpha(ctx, 1);
			if (one.color == '#0099CC' || one.color == '#FFCC00')
				core.fillBoldText(ctx, one.value, one.px, one.py, one.color || 'red', one.boldColor || null, '9px nake2');
			else core.fillBoldText(ctx, one.value, one.px, one.py, one.color || 'red', one.boldColor || null, fontD);
			if (one.frame >= 90) count++;
		});
		if (count > 0) list.splice(0, count);
	}
	if (!main.replayChecking) core.registerAnimationFrame('pop', true, pop);

	/** 添加弹出内容 */
	this.addPop = function (px, py, value, color, boldColor) {
		var data = { px: px, py: py, value: value, color: color || colorD, boldColor: boldColor || boldColorD, frame: 0 };
		if (!core.status.pop) core.status.pop = [data];
		else core.status.pop.push(data);
	}
},
    "enemymeow": function () {
	// 追猎, 抄無敵咕工智障的
	////// 追击逻辑写在了阻击里面 //////
	core.control._checkBlock_repulse = function (repulse) {
		// t[0] == enemy.x, t[1] == enemy.y, t[2] == enemy.id, t[3] == direction
		if (!repulse || repulse.length == 0) return;
		var actions = [];
		var occupied_loc = []; // 已经被其他追击/阻击占据的位置，不让走
		var moved_enemy = [];
		repulse.forEach(function (t) {
			var hero_x = core.status.hero.loc.x,
				hero_y = core.status.hero.loc.y;
			var nextx = t[0],
				nexty = t[1];




			var should_battle = false;

			switch (t[3]) {
			case "right":
				nextx += 1;
				if (nextx == hero_x && nexty == hero_y) should_battle = true;
				//movedRight = true
				break;
			case "left":
				nextx -= 1;
				if (nextx == hero_x && nexty == hero_y) should_battle = true;
				//movedLeft = true
				break;
			case "up":
				nexty -= 1;
				if (nextx == hero_x && nexty == hero_y) should_battle = true;
				//movedUp = true
				break;
			case "down":
				nexty += 1;
				if (nextx == hero_x && nexty == hero_y) should_battle = true;
				//movedDown = true	
				break;
				// 8方阻擊
			case "leftup":
				nextx -= 1
				nexty -= 1
				if (nextx == hero_x && nexty == hero_y) should_battle = true;
				break;
			case "leftdown":
				nextx -= 1
				nexty += 1
				if (nextx == hero_x && nexty == hero_y) should_battle = true;
				break;
			case "rightup":
				nextx += 1
				nexty -= 1
				if (nextx == hero_x && nexty == hero_y) should_battle = true;
				break;
			case "rightdown":
				nextx += 1
				nexty += 1
				if (nextx == hero_x && nexty == hero_y) should_battle = true;
				break;
			}
			//if (!core.hasSpecial(t[2], 29)) should_battle = false;



			if (should_battle) { // 追击强制战斗
				actions.push({
					"type": "function",
					"function": "function() { " +
						"core.battle('" + t[2] + "', " + t[0] + "," + t[1] + ", true, core.doAction); " +
						"}",
					"async": true
				});
			} else {
				if (occupied_loc.indexOf(nextx + "," + nexty) == -1 && core.getBlock(nextx, nexty) == null) { // 未被占据&&空地的格子才可以走上去
					occupied_loc.push(nextx + "," + nexty);
					// 移動時間為 1 (接近瞬移)
					actions.push({ "type": "move", "loc": [t[0], t[1]], "steps": [t[3]], "time": 1, "keep": true, "async": true });

					moved_enemy.push([t[0], t[1], t[2], t[3]])
				}
			}
		})



		if (moved_enemy.length != 0) actions.push({ "type": "waitAsync", "excludeAnimates": true });

		// 追猎後是否戰鬥

		for (var i = 0; i < moved_enemy.length; i++) {
			var hero_x = core.status.hero.loc.x,
				hero_y = core.status.hero.loc.y;
			var nextx = moved_enemy[i][0],
				nexty = moved_enemy[i][1];

			var should_battle = false;
			var moved = false

			switch (moved_enemy[i][3]) {
			case "right":
				nextx += 1
				break;
			case "left":
				nextx -= 1
				break;
			case "up":
				nexty -= 1
				break;
			case "down":
				nexty += 1
				break;
			case "leftup":
				nextx -= 1
				nexty -= 1

				break;
			case "leftdown":
				nextx -= 1
				nexty += 1

				break;
			case "rightup":
				nextx += 1
				nexty -= 1

				break;
			case "rightdown":
				nextx += 1
				nexty += 1

				break;
			}



			for (var j = -2; j < 2; j++) {
				for (var k = -2; k < 2; k++) {
					//	if (!core.material.enemys[moved_enemy[i][2]].zoneSquare) {
					if (Math.abs(j) + Math.abs(k) > 1) continue
					//	}
					var x = nextx + j
					var y = nexty + k
					if (x == hero_x && y == hero_y) should_battle = true
				}
			}
			//console.log(should_battle, nextx, nexty)
			//core.checkBlock()

			var x = nextx,
				y = nexty
			var locx = x - 3,
				zujiguanghuan = 0,
				floorId = core.status.floorId
			while (locx <= x + 3) {
				var locy = y - 3
				while (locy <= y + 3) {
					if (core.getBlock(locx, locy, floorId) != null) {
						if (core.getBlock(locx, locy, floorId).event.cls == "enemys") {
							if (core.hasSpecial(core.getBlock(locx, locy, floorId).event.id, 73)) zujiguanghuan = 1
						}
					}
					locy += 1
					//console.log(x, y)
				}
				locx += 1
			}

			if (!core.hasSpecial(moved_enemy[i][2], 139) && zujiguanghuan === 0) should_battle = false;

			if (core.getFlag("jump", 0) === 1) should_battle = false

			if (should_battle) { // 追击强制战斗
				actions.push({
					"type": "function",
					"function": "function() { " +
						"core.battle('" + moved_enemy[i][2] + "', " + nextx + "," + nexty + ", true, core.doAction); " +
						"}",
					"async": true
				});
			}
		}


		//actions.push({ "type": "waitAsync" });
		core.insertAction(actions);
		//console.log(actions)
	}
}
}
var functions_d6ad677b_427a_4623_b50f_a445a3b0ef8a = 
{
    "events": {
        "resetGame": function (hero, hard, floorId, maps, values) {
	// 重置整个游戏；此函数将在游戏开始时，或者每次读档时最先被调用
	// hero：勇士信息；hard：难度；floorId：当前楼层ID；maps：地图信息；values：全局数值信息

	// 清除游戏数据
	// 这一步会清空状态栏和全部画布内容，并删除所有动态创建的画布
	core.clearStatus();
	// 初始化status
	core.status = core.clone(core.initStatus, function (name) {
		return name != 'hero' && name != 'maps';
	});
	core.control._bindRoutePush();
	core.status.played = true;
	// 初始化人物，图标，统计信息
	core.status.hero = core.clone(hero);
	window.hero = core.status.hero;
	window.flags = core.status.hero.flags;
	core.events.setHeroIcon(core.status.hero.image, true);
	core.control._initStatistics(core.animateFrame.totalTime);
	core.status.hero.statistics.totalTime = core.animateFrame.totalTime =
		Math.max(core.status.hero.statistics.totalTime, core.animateFrame.totalTime);
	core.status.hero.statistics.start = null;
	// 初始难度
	core.status.hard = hard || "";
	// 初始化地图
	core.status.floorId = floorId;
	core.status.maps = maps;
	core.maps._resetFloorImages();
	// 初始化怪物和道具
	core.material.enemys = core.enemys.getEnemys();
	core.material.items = core.items.getItems();
	// 初始化全局数值和全局开关
	core.values = core.clone(core.data.values);
	for (var key in values || {})
		core.values[key] = values[key];
	core.flags = core.clone(core.data.flags);
	var globalFlags = core.getFlag("globalFlags", {});
	for (var key in globalFlags)
		core.flags[key] = globalFlags[key];
	var globals = ["__itemHint__", "autoGetItem", "autoGetGreenKey",  "itemDetail"];
	for (var i in globals) {
		core.setFlag(globals[i], core.getGlobal("global_" + globals[i]));
	}
	core._init_sys_flags();
	// 初始化界面，状态栏等
	core.resize();
	// 状态栏是否显示
	if (core.hasFlag('hideStatusBar'))
		core.hideStatusBar(core.hasFlag('showToolbox'));
	else
		core.showStatusBar();
	// 隐藏右下角的音乐按钮
	core.dom.musicBtn.style.display = 'none';
	core.dom.enlargeBtn.style.display = 'none';
},
        "win": function (reason, norank, noexit) {
	// 游戏获胜事件
	// 请注意，成绩统计时是按照hp进行上传并排名
	// 可以先在这里对最终分数进行计算，比如将2倍攻击和5倍黄钥匙数量加到分数上
	// core.status.hero.hp += 2 * core.getRealStatus('atk') + 5 * core.itemCount('yellowKey');

	// 如果不退出，则临时存储数据
	if (noexit) {
		core.status.extraEvent = core.clone(core.status.event);
	}

	// 游戏获胜事件 
	core.ui.closePanel();
	var replaying = core.isReplaying();
	if (replaying) core.stopReplay();
	core.waitHeroToStop(function () {
		if (!noexit) {
			core.clearMap('all'); // 清空全地图
			core.deleteAllCanvas(); // 删除所有创建的画布
			core.dom.gif2.innerHTML = "";
		}
		reason = core.replaceText(reason);
		core.drawText([
			"\t[" + (reason || "恭喜通关") + "]你的分数是${status:hp}。"
		], function () {
			core.events.gameOver(reason || '', replaying, norank);
		})
	});
},
        "lose": function (reason) {
	// 游戏失败事件
	core.ui.closePanel();
	var replaying = core.isReplaying();
	core.stopReplay();
	core.waitHeroToStop(function () {
		core.drawText([
			"\t[" + (reason || "失败") + "]纳可失败了。\n点击返回标题界面。"
		], function () {
			core.events.gameOver(null, replaying);
		});
	})
},
        "changingFloor": function (floorId, heroLoc) {
	// 正在切换楼层过程中执行的操作；此函数的执行时间是“屏幕完全变黑“的那一刻
	// floorId为要切换到的楼层ID；heroLoc表示勇士切换到的位置

	// ---------- 此时还没有进行切换，当前floorId还是原来的 ---------- //
	var currentId = core.status.floorId || null; // 获得当前的floorId，可能为null
	var fromLoad = core.hasFlag('__fromLoad__'); // 是否是读档造成的切换
	var isFlying = core.hasFlag('__isFlying__'); // 是否是楼传造成的切换
	if (!fromLoad && !(isFlying && currentId == floorId)) {
		if (!core.hasFlag("__leaveLoc__")) core.setFlag("__leaveLoc__", {});
		if (currentId != null) core.getFlag("__leaveLoc__")[currentId] = core.clone(core.status.hero.loc);
	}

	// 可以对currentId进行判定，比如删除某些自定义图层等
	// if (currentId == 'MT0') {
	//     core.deleteAllCanvas();
	// }

	// 根据分区信息自动砍层与恢复
	if (core.autoRemoveMaps) core.autoRemoveMaps(floorId);

	// 重置画布尺寸
	core.maps.resizeMap(floorId);
	// 设置勇士的位置
	heroLoc.direction = core.turnDirection(heroLoc.direction);
	core.status.hero.loc = heroLoc;
	// 检查重生怪并重置
	if (!fromLoad) {
		core.extractBlocks(floorId);
		core.status.maps[floorId].blocks.forEach(function (block) {
			if (block.disable && core.enemys.hasSpecial(block.event.id, 23)) {
				block.disable = false;
				core.setMapBlockDisabled(floorId, block.x, block.y, false);
				core.maps._updateMapArray(floorId, block.x, block.y);
			}
		});
		core.control.gatherFollowers();
	}

	// ---------- 重绘新地图；这一步将会设置core.status.floorId ---------- //
	core.drawMap(floorId);

	// 切换楼层BGM
	if (core.status.maps[floorId].bgm) {
		var bgm = core.status.maps[floorId].bgm;
		if (bgm instanceof Array) bgm = bgm[Math.floor(Math.random() * bgm.length)]; // 多个bgm则随机播放一个
		if (!core.hasFlag("__bgm__")) core.playBgm(bgm);
	} else if (fromLoad && !core.hasFlag("__bgm__")) {
		core.pauseBgm();
	}
	// 更改画面色调
	var color = core.getFlag('__color__', null);
	if (!color && core.status.maps[floorId].color)
		color = core.status.maps[floorId].color;
	core.clearMap('curtain');
	core.status.curtainColor = color;
	if (color) core.fillRect('curtain', 0, 0, core.__PIXELS__, core.__PIXELS__, core.arrayToRGBA(color));
	// 更改天气
	var weather = core.getFlag('__weather__', null);
	if (!weather && core.status.maps[floorId].weather)
		weather = core.status.maps[floorId].weather;
	if (weather)
		core.setWeather(weather[0], weather[1]);
	else core.setWeather();

	// ...可以新增一些其他内容，比如创建个画布在右上角显示什么内容等等

},
        "afterChangeFloor": function (floorId) {
	// 转换楼层结束的事件；此函数会在整个楼层切换完全结束后再执行
	// floorId是切换到的楼层

	// 如果是读档，则进行检查（是否需要恢复事件）
	if (core.hasFlag('__fromLoad__')) {
		core.events.recoverEvents(core.getFlag("__events__"));
		core.removeFlag("__events__");
	} else {
		// 每次抵达楼层执行的事件
		core.insertAction(core.floors[floorId].eachArrive);

		// 首次抵达楼层时执行的事件（后插入，先执行）
		if (!core.hasVisitedFloor(floorId)) {
			core.insertAction(core.floors[floorId].firstArrive);
			core.visitFloor(floorId);
		}
		core.plugin.autoBattle();
	}
},
        "flyTo": function (toId, callback) {
	// 楼层传送器的使用，从当前楼层飞往toId
	// 如果不能飞行请返回false

	var fromId = core.status.floorId;

	// 检查能否飞行
	if (!core.status.maps[fromId].canFlyFrom || !core.status.maps[toId].canFlyTo || !core.hasVisitedFloor(toId)) {
		core.playSound('操作失败');
		core.drawTip("无法飞往" + core.status.maps[toId].title + "！", 'fly');
		return false;
	}

	// 平面塔模式
	var stair = null,
		loc = null;
	if (core.flags.flyRecordPosition) {
		loc = core.getFlag("__leaveLoc__", {})[toId] || null;
	}
	if (core.status.maps[toId].flyPoint != null && core.status.maps[toId].flyPoint.length == 2) {
		stair = 'flyPoint';
	}
	if (stair == null && loc == null) {
		// 获得两个楼层的索引，以决定是上楼梯还是下楼梯
		var fromIndex = core.floorIds.indexOf(fromId),
			toIndex = core.floorIds.indexOf(toId);
		var stair = fromIndex <= toIndex ? "downFloor" : "upFloor";
		// 地下层：同层传送至上楼梯
		if (fromIndex == toIndex && core.status.maps[fromId].underGround) stair = "upFloor";
	}

	// 记录录像
	core.status.route.push("fly:" + toId);
	// 传送
	core.ui.closePanel();
	core.setFlag('__isFlying__', true);
	core.changeFloor(toId, stair, loc, null, function () {
		core.removeFlag("__isFlying__");
		if (callback) callback();
	});

	return true;
},
        "beforeBattle": function (enemyId, x, y) {
	// 战斗前触发的事件，可以加上一些战前特效（详见下面支援的例子）
	// 此函数在“检测能否战斗和自动存档”【之后】执行。如果需要更早的战前事件，请在插件中覆重写 core.events.doSystemEvent 函数。
	// 返回true则将继续战斗，返回false将不再战斗。

	// ------ 支援技能 ------ //
	if (x != null && y != null) {
		var index = x + "," + y,
			cache = core.status.checkBlock.cache[index] || {},
			guards = cache.guards || [];
		// 如果存在支援怪
		if (guards.length > 0) {
			// 记录flag，当前要参与支援的怪物
			core.setFlag("__guards__" + x + "_" + y, guards);
			var actions = [{ "type": "playSound", "name": "跳跃" }];
			// 增加支援的特效动画（图块跳跃）
			guards.forEach(function (g) {
				core.push(actions, { "type": "jump", "from": [g[0], g[1]], "to": [x, y], "time": 300, "keep": false, "async": true });
			});
			core.push(actions, [
				{ "type": "waitAsync" }, // 等待所有异步事件执行完毕
				{
					"type": "setBlock",
					"number": enemyId,
					"loc": [
						[x, y]
					]
				}, // 重新设置怪物自身
				{ "type": "battle", "loc": [x, y] } // 重要！重新触发本次战斗
			]);
			core.insertAction(actions);
			return false;
		}
	}

	return true;
},
        "afterBattle": function (enemyId, x, y) {
	// 战斗结束后触发的事件

	var enemy = core.material.enemys[enemyId];
	var special = enemy.special;

	// 播放战斗音效和动画
	// 默认播放的动画；你也可以使用
	var animate = 'hand'; // 默认动画
	// 检查当前装备是否存在攻击动画
	var equipId = core.getEquip(0);
	if (equipId && (core.material.items[equipId].equip || {}).animate)
		animate = core.material.items[equipId].equip.animate;
	// 你也可以在这里根据自己的需要，比如enemyId或special或flag来修改播放的动画效果
	// if (enemyId == '...') animate = '...';
	if (flags.zuxian == 1) animate = 'hand2';

	// 检查该动画是否存在SE，如果不存在则使用默认音效
	if (!(core.material.animates[animate] || {}).se)
		core.playSound('attack.mp3');

	// 播放动画；如果不存在坐标（强制战斗）则播放到勇士自身
	if (x != null && y != null)
		core.drawAnimate(animate, x, y);
	else
		core.drawHeroAnimate(animate);


	var resurrect = false;


	// 获得战斗伤害信息
	var damageInfo = core.getDamageInfo(enemyId, null, x, y) || {};
	// 战斗伤害
	var damage = damageInfo.damage;
	// 当前战斗回合数，可用于战后所需的判定
	var turn = damageInfo.turn;
	// 判定是否致死
	if (damage == null || damage >= core.status.hero.hp) {
		core.status.hero.hp = 0;
		core.updateStatusBar();
		core.events.lose('战斗失败');
		return;
	}

	// 扣减体力值并记录统计数据
	core.status.hero.hp -= damage;
	core.status.hero.statistics.battleDamage += damage;
	core.status.hero.statistics.battle++;

	// 计算当前怪物的支援怪物
	var guards = [];
	if (x != null && y != null) {
		guards = core.getFlag("__guards__" + x + "_" + y, []);
		core.removeFlag("__guards__" + x + "_" + y);
	}




	// 败移
	if (core.hasSpecial(enemyId, 88)) {

		//套一个求援
		if (core.hasSpecial(enemy.special, 89)) {
			if (!core.getSwitch(x, y, core.status.floorId, "inqy", false)) {
				core.setSwitch(x, y, core.status.floorId, "inqy", true)
				core.addFlag("qy", 1)
				core.setFlag("disable_autosave2", 1);
				core.setFlag("disable_autosave", 1);
				flags.__forbidSave__ = true;
				battleenemy(x + 1, y);
				battleenemy(x - 1, y);
				battleenemy(x + 1, y + 1);
				battleenemy(x - 1, y + 1);
				battleenemy(x + 1, y - 1);
				battleenemy(x - 1, y - 1);
				battleenemy(x, y + 1);
				battleenemy(x, y - 1);
				battleenemy(x, y + 2);
				battleenemy(x, y - 2);
				battleenemy(x - 2, y);
				battleenemy(x + 2, y);
				flags.__forbidSave__ = false;
				core.addFlag("qy", -1)
				if (core.getFlag("qy") == 0) {
					core.setFlag("disable_autosave2", 0);
					core.setFlag("disable_autosave", 0);
				}
			}
		}
		if (x != null && y != null) {
			// 判断该列有没有怪物，如果有，循环递减，直到找到一个最近的怪物，并和它交换位置，按照正常战斗流程战斗
			//for (var i = 2; i <= 13; i++) {
			//	var x1 = core.nextX(i);
			//	var y1 = core.nextY(i);

			width = core.bigmap.width;
			height = core.bigmap.height;
			search_range = Math.max(width, height); //适应大地图
			for (var i = 1; i <= search_range; i++) {
				var x1 = core.nextX(i);
				var y1 = core.nextY(i);
				if (x == x1 && y == y1) continue;

				// 判断格子内的事件是否为怪物
				if (x1 > width || x1 < 0 || y1 > height || y1 < 0) break;
				if (core.getBlockCls(x1, y1) == "enemys" || core.getBlockCls(x1, y1) == "enemy48") {

					if (core.enemys.hasSpecial(special, 99)) { //
						core.addFlag("sq99", -1);
					}
					if (core.enemys.hasSpecial(special, 100)) { //
						core.addFlag("sq100", -1);
					}
					if (core.enemys.hasSpecial(special, 102)) { //
						core.addFlag("sq102", -1);
					}
					if (core.enemys.hasSpecial(special, 103)) { //
						core.addFlag("sq103", -1);
					}
					if (core.enemys.hasSpecial(special, 105)) { //
						core.addFlag("sq105", -1);
					}

					var block = core.getBlockId(x1, y1);
					var enemyId2 = core.material.enemys[block].id;
					// 将这两个怪物互相转换为新怪物
					core.insertAction([{
							"type": "setBlock",
							"number": enemyId,
							"loc": [
								[x1, y1]
							],
							"time": 300
						},
						{
							"type": "setBlock",
							"number": enemyId2,
							"loc": [
								[x, y]
							],
							"time": 300
						}
					]);
					resurrect = true;
					break;
				}
			}
		}
	}




	// 获得金币
	var money = guards.reduce(function (curr, g) {
		return curr + core.material.enemys[g[2]].money;
	}, core.getEnemyValue(enemy, "money", x, y));
	if (core.hasItem('coin')) money *= 2; // 幸运金币：双倍
	if (core.hasFlag('curse')) money = 0; // 诅咒效果
	if (core.hasItem('I1788')) money *= core.itemCount("I1788") + 1; // 禀赋
	if (!resurrect) {
		core.status.hero.money += money;
		core.status.hero.statistics.money += money;
	}

	// 获得经验
	var exp = guards.reduce(function (curr, g) {
		return curr + core.material.enemys[g[2]].exp;
	}, core.getEnemyValue(enemy, "exp", x, y));
	if (core.hasFlag('curse')) exp = 0;
	if (core.hasItem('I608')) exp *= core.itemCount("I608"); // 禀赋
	if (!resurrect) {
		core.status.hero.exp += exp;
		core.status.hero.statistics.exp += exp;
	}

	core.addPop(x * 32, y * 32 + 16, "" + core.formatBigNumber(exp, true), "#ace8b9");
	if (core.hasItem("I955")) core.addPop(x * 32, y * 32, "" + core.formatBigNumber(money, true), "#faa0e9");

	if (core.getFlag("s113", 0) > 0) {
		flags.s113 -= 1;
	}

	if (core.getFlag("s114", 0) > 0) {
		flags.s114 -= 1;
	}

	if (core.getFlag("s120", 0) > 0) {
		flags.s120 -= 1;
	}

	if (core.getFlag("s121", 0) > 0) {
		flags.s121 -= 1;
	}
	if (core.getFlag("s141", 0) > 0) {
		flags.s141 -= 1;
	}
	if (core.getFlag("s142", 0) > 0) {
		flags.s142 -= 1;
	}

	if (core.getFlag("s143", 0) > 0) {
		flags.s143 -= 1;
	}
	if (core.getFlag("s157", 0) > 0) {
		flags.s157 -= 1;
	}
	var hint = "打败 " + core.getEnemyValue(enemy, "name", x, y);
	if (core.flags.statusBarItems.indexOf('enableMoney') >= 0)
		hint += ',' + core.getStatusLabel('money') + '+' + Math.ceil(money); // hint += "，金币+" + money;
	if (core.flags.statusBarItems.indexOf('enableExp') >= 0)
		hint += ',' + core.getStatusLabel('exp') + '+' + exp; // hint += "，经验+" + exp;
	core.drawTip(hint, enemy.id);

	// 中毒
	if (core.enemys.hasSpecial(special, 12)) {
		core.triggerDebuff('get', 'poison');
	}
	// 衰弱
	if (core.enemys.hasSpecial(special, 13)) {
		core.triggerDebuff('get', 'weak');
	}
	// 诅咒
	if (core.enemys.hasSpecial(special, 14)) {
		core.triggerDebuff('get', 'curse');
	}
	// 仇恨怪物将仇恨值减半
	if (core.enemys.hasSpecial(special, 17)) {
		core.setFlag('hatred', Math.floor(core.getFlag('hatred', 0) / 2));
	}
	// 自爆
	if (core.enemys.hasSpecial(special, 19)) {
		core.status.hero.statistics.battleDamage += core.status.hero.hp - 1;
		core.status.hero.hp = 1;
	}
	// 退化
	if (core.enemys.hasSpecial(special, 21)) {
		core.status.hero.atk -= (enemy.atkValue || 0);
		core.status.hero.def -= (enemy.defValue || 0);
		if (core.status.hero.atk < 0) core.status.hero.atk = 0;
		if (core.status.hero.def < 0) core.status.hero.def = 0;
	}

	// 怠惰
	if (core.enemys.hasSpecial(special, 84)) {
		if (core.status.hero.loc.direction == 'left') {
			core.setBlock(1035, core.nextX() + 2, core.nextY());
			core.setBlock(1035, core.nextX() + 1, core.nextY() + 1);
			core.setBlock(1035, core.nextX() + 1, core.nextY() - 1)
		}
		if (core.status.hero.loc.direction == 'right') {
			core.setBlock(1035, core.nextX() - 2, core.nextY());
			core.setBlock(1035, core.nextX() - 1, core.nextY() - 1);
			core.setBlock(1035, core.nextX() - 1, core.nextY() + 1)
		}
		if (core.status.hero.loc.direction == 'up') {
			core.setBlock(1035, core.nextX(), core.nextY() + 2);
			core.setBlock(1035, core.nextX() - 1, core.nextY() + 1);
			core.setBlock(1035, core.nextX() + 1, core.nextY() + 1)
		}
		if (core.status.hero.loc.direction == 'down') {
			core.setBlock(1035, core.nextX(), core.nextY() - 2);
			core.setBlock(1035, core.nextX() + 1, core.nextY() - 1);
			core.setBlock(1035, core.nextX() - 1, core.nextY() - 1)
		}
	}

	// 死线
	if (core.getFlag("gs85", 0) > 0 && core.status.hero.hp > 0) {
		core.status.hero.hp += core.getFlag("gs85", 0) * 4;
		core.setFlag("gs85", 0);
		var animate = 'chaoju';
		core.drawHeroAnimate(animate);
	}
	if (core.enemys.hasSpecial(special, 85)) {
		core.setFlag("gs85", core.status.hero.hp / 5);
		core.status.hero.hp = core.status.hero.hp / 5;
		var animate = 'chaoju';
		core.drawHeroAnimate(animate);
	}

	// 吹火
	if (core.enemys.hasSpecial(special, 86)) {
		var steps = [];
		for (var i = -1; i > -641; --i) {
			if (core.nextX(i) >= 0 && core.nextY(i) >= 0 && core.nextX(i) < core.bigmap.width && core.nextY(i) < core.bigmap.height &&
				core.getBlock(core.nextX(i), core.nextY(i)) == null) {
				steps.push("backward");
			} else {
				break;
			}
		}
		var actions = [{ "type": "animate", "name": "skill3", "loc": "hero", "async": true }];
		if (steps.length) {
			actions.push({ "type": "moveHero", "steps": steps });
		}
		core.insertAction(actions);
	}



	if (core.enemys.hasSpecial(special, 113)) {
		core.setFlag("s113", 2);
		var animate = 'an';
		core.drawHeroAnimate(animate);
	}

	if (core.enemys.hasSpecial(special, 114)) {
		core.setFlag("s114", 2);
		var animate = 'an';
		core.drawHeroAnimate(animate);
	}

	if (core.enemys.hasSpecial(special, 120)) {
		core.setFlag("s120", 2);
		var animate = 'water';
		core.drawHeroAnimate(animate);
	}

	if (core.enemys.hasSpecial(special, 121)) {
		core.setFlag("s121", 2);
		var animate = 'water';
		core.drawHeroAnimate(animate);
	}

	if (core.enemys.hasSpecial(special, 141)) {
		core.setFlag("s141", 2);
		var animate = 'jidi';
		core.drawHeroAnimate(animate);
	}

	if (core.enemys.hasSpecial(special, 142)) {
		core.setFlag("s142", 2);
		var animate = 'magic';
		core.drawHeroAnimate(animate);
	}

	// 溯回间
	if (core.enemys.hasSpecial(special, 143)) {
		core.setFlag("s143", 1);
		var animate = 'yongchang';
		core.drawHeroAnimate(animate);
	}
	if (core.enemys.hasSpecial(special, 157)) {
		core.setFlag("s157", 3);
		var animate = 'an';
		core.drawHeroAnimate(animate);
	}
	if (core.enemys.hasSpecial(special, 156)) {
		var animate = 'chaoju';
		core.drawHeroAnimate(animate);
	}
	// 增加仇恨值
	core.setFlag('hatred', core.getFlag('hatred', 0) + core.values.hatred);

	// 战后的技能处理，比如扣除魔力值
	if (core.flags.statusBarItems.indexOf('enableSkill') >= 0) {
		// 检测当前开启的技能类型
		var skill = core.getFlag('skill', 0);
		if (skill == 1) { // 技能1：二倍斩
			core.status.hero.mana -= 5; // 扣除5点魔力值
		}
		// 关闭技能
		core.setFlag('skill', 0);
		core.setFlag('skillName', '无');
	}

	if (core.enemys.hasSpecial(special, 99)) { //
		core.addFlag("sq99", 1);
	}
	if (core.enemys.hasSpecial(special, 100)) { //
		core.addFlag("sq100", 1);
	}
	if (core.enemys.hasSpecial(special, 102)) { //
		core.addFlag("sq102", 1);
	}
	if (core.enemys.hasSpecial(special, 103)) { //
		core.addFlag("sq103", 1);
	}
	if (core.enemys.hasSpecial(special, 105)) { //
		core.addFlag("sq105", 1);
	}
	if (core.enemys.hasSpecial(special, 115)) { //
		core.addFlag("sq115", 1);
	}
	if (core.enemys.hasSpecial(special, 116)) { //
		core.addFlag("sq116", 1);
	}
	if (core.enemys.hasSpecial(special, 126)) { //
		core.addFlag("sq126", 1);
	}
	if (core.enemys.hasSpecial(special, 144)) { //
		core.addFlag("sq144", 1);
	}
	if (core.enemys.hasSpecial(special, 155)) { //
		core.addFlag("sq155", 1);
	}

	// 事件的处理
	var todo = [];

	// 加点事件
	var point = guards.reduce(function (curr, g) {
		return curr + core.material.enemys[g[2]].point;
	}, core.getEnemyValue(enemy, "point", x, y)) || 0;
	if (core.flags.enableAddPoint && point > 0) {
		core.push(todo, [{ "type": "insert", "name": "加点事件", "args": [point] }]);
	}

	// 战后事件
	if (core.status.floorId != null) {
		core.push(todo, core.floors[core.status.floorId].afterBattle[x + "," + y]);
	}
	core.push(todo, enemy.afterBattle);

	// 在这里增加其他的自定义事件需求
	/*
	if (enemyId=='xxx') {
		core.push(todo, [
			{"type": "...", ...},
		]);
	}
	*/

	// 如果事件不为空，将其插入
	if (todo.length > 0) core.insertAction(todo, x, y);

	// 删除该点设置的怪物信息
	delete((flags.enemyOnPoint || {})[core.status.floorId] || {})[x + "," + y];

	// 因为removeBlock和hideBlock都会刷新状态栏，因此将删除部分移动到这里并保证刷新只执行一次，以提升效率
	if (core.getBlock(x, y) != null) {
		// 检查是否是重生怪物；如果是则仅隐藏不删除
		if (core.hasSpecial(enemy.special, 23)) {
			core.hideBlock(x, y);
		} else {
			core.removeBlock(x, y);
		}
	} else {
		core.updateStatusBar();
	}


	function battleenemy(p, q) {
		if (core.getBlockCls(p, q) == "enemys" || core.getBlockCls(p, q) == "enemy48") {
			var enemyid = core.getBlockId(p, q);
			core.battle(enemyid, p, q, true);
		}
	}

	// 锈胎
	if (core.enemys.hasSpecial(special, 67)) {
		var x = core.status.hero.loc.x,
			y =
			core.status.hero.loc.y;
		if (!core.noPass(x - 1, y)) core.setBlock(456, x - 1, y);
		if (!core.noPass(x + 1, y)) core.setBlock(456, x + 1, y);
		if (!core.noPass(x, y - 1)) core.setBlock(456, x, y - 1);
		if (!core.noPass(x, y + 1)) core.setBlock(456, x, y + 1);
	}

	// 塔门
	if (core.enemys.hasSpecial(special, 70)) {
		var x = core.status.hero.loc.x,
			y =
			core.status.hero.loc.y;
		if (!core.noPass(x - 1, y)) core.setBlock(480, x - 1, y);
		if (!core.noPass(x + 1, y)) core.setBlock(480, x + 1, y);
		if (!core.noPass(x, y - 1)) core.setBlock(480, x, y - 1);
		if (!core.noPass(x, y + 1)) core.setBlock(480, x, y + 1);
	}

	// 贪婪
	if (core.enemys.hasSpecial(special, 81)) {
		var x = core.status.hero.loc.x,
			y =
			core.status.hero.loc.y;
		if (!core.noPass(x - 1, y)) core.setBlock(329, x - 1, y);
		if (!core.noPass(x + 1, y)) core.setBlock(329, x + 1, y);
		if (!core.noPass(x, y - 1)) core.setBlock(329, x, y - 1);
	}

	// 围杀神儡
	if (core.enemys.hasSpecial(special, 140)) {
		var x = core.status.hero.loc.x,
			y = core.status.hero.loc.y;
		var x1 = x;
		var y1 = y;
		for (x1 = x - 2; x1 <= x + 2; x1 += 2) {
			for (y1 = y - 2; y1 <= y + 2; y1 += 2) {
				if ((core.getBlock(x1, y1) == null || core.isMapBlockDisabled(core.status.floorId, x1, y1)) && !core.noPass(x1, y1) && !(x1 == x && y1 == y)) {
					core.setBlock(1821, x1, y1);
				}
			}
		}
	}

	// 围杀神儡

	if (core.enemys.hasSpecial(special, 159)) {
		var x = core.status.hero.loc.x,
			y = core.status.hero.loc.y;
		var x1 = x;
		var y1 = y;
		for (x1 = x - 2; x1 <= x + 2; x1 += 2) {
			for (y1 = y - 2; y1 <= y + 2; y1 += 2) {
				if ((core.getBlock(x1, y1) == null || core.isMapBlockDisabled(core.status.floorId, x1, y1)) && !core.noPass(x1, y1) && !(x1 == x && y1 == y)) {
					core.setBlock(2004, x1, y1);
				}
			}
		}
	}


	// 求援
	if (core.hasSpecial(enemy.special, 89)) {
		if (core.hasSpecial(enemy.special, 88)) {} else {
			if (!core.getSwitch(x, y, core.status.floorId, "inqy", false)) {
				core.setSwitch(x, y, core.status.floorId, "inqy", true)
				core.addFlag("qy", 1)
				core.setFlag("disable_autosave2", 1);
				core.setFlag("disable_autosave", 1);
				flags.__forbidSave__ = true;
				battleenemy(x + 1, y);
				battleenemy(x - 1, y);
				battleenemy(x + 1, y + 1);
				battleenemy(x - 1, y + 1);
				battleenemy(x + 1, y - 1);
				battleenemy(x - 1, y - 1);
				battleenemy(x, y + 1);
				battleenemy(x, y - 1);
				battleenemy(x, y + 2);
				battleenemy(x, y - 2);
				battleenemy(x - 2, y);
				battleenemy(x + 2, y);
				flags.__forbidSave__ = false;
				core.addFlag("qy", -1)
				if (core.getFlag("qy") == 0) {
					core.setFlag("disable_autosave2", 0);
					core.setFlag("disable_autosave", 0);
				}
			}
		}
	}
	// 如果已有事件正在处理中
	if (core.status.event.id == null)
		core.continueAutomaticRoute();
	else
		core.clearContinueAutomaticRoute();

},
        "afterOpenDoor": function (doorId, x, y) {
	// 开一个门后触发的事件

	var todo = [];
	// 检查该点的开门后事件
	if (core.status.floorId) {
		core.push(todo, core.floors[core.status.floorId].afterOpenDoor[x + "," + y]);
	}
	// 检查批量开门事件
	var door = core.getBlockById(doorId);
	if (door && door.event.doorInfo) {
		core.push(todo, door.event.doorInfo.afterOpenDoor);
	}

	if (todo.length > 0) core.insertAction(todo, x, y);

	if (core.status.event.id == null)
		core.continueAutomaticRoute();
	else
		core.clearContinueAutomaticRoute();

		core.plugin.autoBattle();
},
        "afterGetItem": function (itemId, x, y, isGentleClick) {
	// 获得一个道具后触发的事件
	// itemId：获得的道具ID；x和y是该道具所在的坐标
	// isGentleClick：是否是轻按触发的
	if ((itemId.endsWith('Potion') || itemId == "poisonWine" || itemId == "weakWine" || itemId == "I572" || itemId == "curseWine" || itemId == "I619" || itemId == "I620" || itemId == "I621" || itemId == "I622" || itemId == "I1009" || itemId == "I1010" || itemId == "I1011" || itemId == "I1012" || itemId == "I1486" || itemId == "I1487" || itemId == "I1488" || itemId == "I1489" || itemId == "I1158" || itemId == "I1159" || itemId == "I1160" || itemId == "I1161" || itemId == "I1166" || itemId == "I1167" || itemId == "I1168" || itemId == "I1169") && core.material.items[itemId].cls == 'items') {
		core.playSound('回血');
		core.drawHeroAnimate("xue");
	} else if ((itemId.endsWith('Gem') || itemId == "I576" || itemId == "I577" || itemId == "I578" || itemId == "I579" || itemId == "I584" || itemId == "I585" || itemId == "I586" || itemId == "I587" || itemId == "I635" || itemId == "I636" || itemId == "I637" || itemId == "I638" || itemId == "I639" || itemId == "I640" || itemId == "I641" || itemId == "I642" || itemId == "I643" || itemId == "I644" || itemId == "I645" || itemId == "I646" || itemId == "I1013" || itemId == "I1014" || itemId == "I1015" || itemId == "I1016" || itemId == "I1017" || itemId == "I1018" || itemId == "I1019" || itemId == "I1020" || itemId == "I1021" || itemId == "I1022" || itemId == "I1023" || itemId == "I1024" || itemId == "I1423" || itemId == "I1424" || itemId == "I1425" || itemId == "I1426") && core.material.items[itemId].cls == 'items') {
		core.playSound('宝石');
		if (itemId == "I576" || itemId == "I584" || itemId == "I635" || itemId == "I639" || itemId == "I643" || itemId == "I1013" || itemId == "I1017" || itemId == "I1021" || itemId == "I1423" || itemId == "redGem")
			core.drawHeroAnimate("red");
		else if (itemId == "I577" || itemId == "I585" || itemId == "I636" || itemId == "I640" || itemId == "I644" || itemId == "I1014" || itemId == "I1018" || itemId == "I1022" || itemId == "I1424" || itemId == "blueGem")
			core.drawHeroAnimate("blue");
		else if (itemId == "I579" || itemId == "I587" || itemId == "I638" || itemId == "I642" || itemId == "I646" || itemId == "I1016" || itemId == "I1020" || itemId == "I1024" || itemId == "I1426" || itemId == "yellowGem")
			core.drawHeroAnimate("yellow");
		else if (itemId == "I578" || itemId == "I586" || itemId == "I637" || itemId == "I641" || itemId == "I645" || itemId == "I1015" || itemId == "I1019" || itemId == "I1023" || itemId == "I1425" || itemId == "greenGem")
			core.drawHeroAnimate("green");

	} else
		core.playSound('获得道具');



	//跳字
	if (itemId == "yellowKey") {
		core.addPop(core.getHeroLoc('x') * 32, core.getHeroLoc('y') * 32, "黄钥匙+1", "#f7fcc7")
	}
	if (itemId == "blueKey") {
		core.addPop(core.getHeroLoc('x') * 32, core.getHeroLoc('y') * 32, "蓝钥匙+1", "#c7f2fc")
	}
	if (itemId == "redKey") {
		core.addPop(core.getHeroLoc('x') * 32, core.getHeroLoc('y') * 32, "红钥匙+1", "#fcc7ce")
	}
	if (itemId == "I1006") {
		core.addPop(core.getHeroLoc('x') * 32, core.getHeroLoc('y') * 32, "黄钥匙+3", "#f7fcc7")
	}
	if (itemId == "I1007") {
		core.addPop(core.getHeroLoc('x') * 32, core.getHeroLoc('y') * 32, "蓝钥匙+3", "#c7f2fc")
	}
	if (itemId == "I1008") {
		core.addPop(core.getHeroLoc('x') * 32, core.getHeroLoc('y') * 32, "红钥匙+3", "#fcc7ce")
	}
	if (itemId == "I1184") {
		core.addPop(core.getHeroLoc('x') * 32, core.getHeroLoc('y') * 32, "黄钥匙+9", "#f7fcc7")
	}
	if (itemId == "I1185") {
		core.addPop(core.getHeroLoc('x') * 32, core.getHeroLoc('y') * 32, "蓝钥匙+9", "#c7f2fc")
	}
	if (itemId == "I1186") {
		core.addPop(core.getHeroLoc('x') * 32, core.getHeroLoc('y') * 32, "红钥匙+9", "#fcc7ce")
	}
	if (itemId == "greenKey") {
		core.addPop(core.getHeroLoc('x') * 32, core.getHeroLoc('y') * 32, "绿钥匙+1", "#7ffa8c")
	}
	if (itemId == "I902") {
		core.addPop(core.getHeroLoc('x') * 32, core.getHeroLoc('y') * 32, "绿钥匙+4", "#7ffa8c")
	}
	if (itemId == "I570") {
		core.addPop(core.getHeroLoc('x') * 32, core.getHeroLoc('y') * 32, "绿钥匙+10", "#7ffa8c")
	}
	if (itemId == "pickaxe") {
		core.addPop(core.getHeroLoc('x') * 32, core.getHeroLoc('y') * 32, "破墙镐+1", "#bdc2bc")
	}
	if (itemId == "centerFly") {
		core.addPop(core.getHeroLoc('x') * 32, core.getHeroLoc('y') * 32, "飞行器+1", "#e0d486")
	}
	if (itemId == "I732") {
		core.addPop(core.getHeroLoc('x') * 32, core.getHeroLoc('y') * 32, "磁吸石+1", "#7edae8")
	}
	if (itemId == "I733") {
		core.addPop(core.getHeroLoc('x') * 32, core.getHeroLoc('y') * 32, "换位标靶+1", "#ffffff")
	}
	if (itemId == "I1437") {
		core.addPop(core.getHeroLoc('x') * 32, core.getHeroLoc('y') * 32, "领悟+100", "#faa0e9")
	}
	if (itemId == "I1438") {
		core.addPop(core.getHeroLoc('x') * 32, core.getHeroLoc('y') * 32, "领悟+1000", "#faa0e9")
	}
	if (itemId == "I1439") {
		core.addPop(core.getHeroLoc('x') * 32, core.getHeroLoc('y') * 32, "领悟+10000", "#faa0e9")
	}
	if (itemId == "I1440") {
		core.addPop(core.getHeroLoc('x') * 32, core.getHeroLoc('y') * 32, "领悟+10万", "#faa0e9")
	}
	if (itemId == "I1441") {
		core.addPop(core.getHeroLoc('x') * 32, core.getHeroLoc('y') * 32, "领悟+100万", "#faa0e9")
	}
	if (itemId == "I1442") {
		core.addPop(core.getHeroLoc('x') * 32, core.getHeroLoc('y') * 32, "领悟+1000万", "#faa0e9")
	}
	if (itemId == "I1443") {
		core.addPop(core.getHeroLoc('x') * 32, core.getHeroLoc('y') * 32, "领悟+10万", "#faa0e9")
	}
	if (itemId == "I1444") {
		core.addPop(core.getHeroLoc('x') * 32, core.getHeroLoc('y') * 32, "领悟+100万", "#faa0e9")
	}
	if (itemId == "I1445") {
		core.addPop(core.getHeroLoc('x') * 32, core.getHeroLoc('y') * 32, "领悟+1亿", "#faa0e9")
	}
	if (itemId == "I1446") {
		core.addPop(core.getHeroLoc('x') * 32, core.getHeroLoc('y') * 32, "领悟+10亿", "#faa0e9")
	}
	if (itemId == "I1447") {
		core.addPop(core.getHeroLoc('x') * 32, core.getHeroLoc('y') * 32, "领悟+100亿", "#faa0e9")
	}
	if (itemId == "I1448") {
		core.addPop(core.getHeroLoc('x') * 32, core.getHeroLoc('y') * 32, "领悟+1000亿", "#faa0e9")
	}



	var todo = [];
	// 检查该点的获得道具后事件。
	if (core.status.floorId == null) return;
	var event = core.floors[core.status.floorId].afterGetItem[x + "," + y];
	if (event && (event instanceof Array || !isGentleClick || !event.disableOnGentleClick)) {
		core.unshift(todo, event);
	}

	if (todo.length > 0) core.insertAction(todo, x, y);
},
        "afterPushBox": function () {
	// 推箱子后的事件
	if (core.searchBlock('box').length == 0) {
		// 可以通过if语句来进行开门操作
		/*
		if (core.status.floorId=='xxx') { // 在某个楼层
			core.insertAction([ // 插入一条事件
				{"type": "openDoor", "loc": [x,y]} // 开门
			])
		}
		*/
	}
}
    },
    "enemys": {
        "getSpecials": function () {
	// 获得敌人的特殊属性，每一行定义一个特殊属性。
	// 分为五项，第一项为该特殊属性的数字，第二项为特殊属性的名字，第三项为特殊属性的描述
	// 第四项为该特殊属性的颜色，可以写十六进制 #RRGGBB 或者 [r,g,b,a] 四元数组
	// 第五项为该特殊属性的标记；目前 1 代表是地图类技能（需要进行遍历全图）
	// 名字和描述可以直接写字符串，也可以写个function将敌人传进去
	return [
		[1, "迅捷", "这个敌人出手快人一步。\n敌人\r[yellow]首先攻击\r。", "#ffcc33"],
		[2, "魔攻", "这个敌人似乎掌握了魔法。\n敌人\r[yellow]无视角色的防御\r。", "#bbb0ff"],
		[3, "坚固", "这个敌人拥有土元素之力，坚不可摧。\n敌人防御不小于\r[#87CEFA]角色攻击-1\r。", "#c0b088"],
		[4, "2连击", "敌人进攻速度很快，拥有更加恐怖的杀伤力，但同时也意味着生命力会较为脆弱。\n敌人每回合攻击\r[#87CEFA]2次\r。", "#ffee77"],
		[5, "3连击", "敌人进攻速度很快，拥有更加恐怖的杀伤力，但同时也意味着生命力会较为脆弱。\n敌人每回合攻击\r[#87CEFA]3次\r。", "#ffee77"],
		[6, function (enemy) { return (enemy.n || '') + "连击"; }, function (enemy) { return "敌人进攻速度很快，拥有更加恐怖的杀伤力，但同时也意味着生命力会较为脆弱。\n敌人每回合攻击\r[#87CEFA]" + (enemy.n || 4) + "次\r。"; }, "#ffee77"],
		[7, "破甲", function (enemy) { return "战斗前，敌人附加角色防御的\r[#87CEFA]" + Math.floor(100 * (enemy.defValue || core.values.breakArmor || 0)) + "%\r作为伤害"; }, "#b30000"],
		[8, "反击", function (enemy) { return "战斗时，敌人每回合附加角色攻击的\r[#87CEFA]" + Math.floor(100 * (enemy.atkValue || core.values.counterAttack || 0)) + "%\r作为伤害，无视角色防御"; }, "#ffaa44"],
		[9, "净化", function (enemy) { return "战斗前，敌人附加角色护盾的\r[#87CEFA]" + (enemy.n || core.values.purify) + "\r倍作为伤害。"; }, "#80eed6"],
		[10, "模仿", "敌人的攻防和角色攻防相等", "#b0c0dd"],
		[11, "血灵感应", function (enemy) { return "蕴含一丝时、空法则的领悟。通过感知对方的生命力，构造跨越空间与时间的深刻连接。\n战斗中，敌人每回合附带角色\r[#87CEFA]20%\r的攻防和作为伤害，同时角色以\r[#87CEFA]" + Math.floor(100 * enemy.value || 0) + "%\r的生命（\r[#87CEFA]约" + Math.floor((enemy.value || 0) * core.getStatus('hp')) + "点\r）抵扣总伤害。" + (enemy.add ? "，并把伤害数值加到自身生命上" : ""); }, "#ff00d2"],
		[12, "中毒", "战斗后，角色陷入中毒状态，每一步损失生命" + core.values.poisonDamage + "点", "#99ee88"],
		[13, "衰弱", "战斗后，角色陷入衰弱状态，攻防暂时下降" + (core.values.weakValue >= 1 ? core.values.weakValue + "点" : parseInt(core.values.weakValue * 100) + "%"), "#f0bbcc"],
		[14, "诅咒", "战斗后，角色陷入诅咒状态，战斗无法获得金币和经验", "#bbeef0"],
		[15, "领域", function (enemy) { return "经过敌人\r[yellow]周围" + (enemy.zoneSquare ? "九宫格" : "十字") + "\r范围内" + (enemy.range || 1) + "格时自动减生命\r[#87CEFA]" + (enemy.value || 0) + "\r点。"; }, "#c677dd"],
		[16, "夹击", "由伟大的不朽神灵“迪之神”缔造的术式，为制式兵种而生，世界战场上的棘手存在。\n当角色\r[yellow]穿过两个相同的，且拥有该技能的敌人中间\r，角色生命值变成\r[#87CEFA]一半\r。\r[yellow]（该技能效果不会超过怪物伤害）\r。", "#bb99ee"],
		[17, "仇恨", "战斗前，敌人附加之前积累的仇恨值作为伤害；战斗后，释放一半的仇恨值。（每杀死一个敌人获得" + (core.values.hatred || 0) + "点仇恨值）", "#b0b666"],
		[18, "阻击", function (enemy) { return "这个敌人似乎懂得且战且退的道理。\n经过敌人的\r[yellow]" + (enemy.zoneSquare ? "九宫格" : "十字") + "\r领域时自动减生命\r[#87CEFA]" + (enemy.zuji || 0) + "\r点，同时敌人后退一格。"; }, "#8888e6"],
		[19, "自爆", "战斗后角色的生命值变成1", "#ff6666"],
		[20, "小猫", "角色无法打败小猫，除非进入叙事层。", "#aaaaaa"],
		[21, "退化", function (enemy) { return "战斗后角色永久下降" + (enemy.atkValue || 0) + "点攻击和" + (enemy.defValue || 0) + "点防御"; }],
		[22, "灵体", function (enemy) { return "以特殊的生命形式而存在。\r敌人对角色造成\r[#87CEFA]" + (enemy.damage || 0) + "\r点固定伤害，该伤害可被护盾减免，减免效果为护盾的\r[#87CEFA]9倍\r；当角色护盾达到该伤害的\r[#87CEFA]1/10\r时，\r[yellow]灵体失效\r。"; }, "#ff9977"],
		[23, "不灭", "可惜没有办法刷经验……\n敌人被击败后，角色转换楼层则敌人将再次出现。", "#a0e0ff"],
		[24, "激光", function (enemy) { return "经过\r[yellow]敌人同行或同列\r时自动减生命\r[#87CEFA]" + (enemy.value || 0) + "\r点"; }, "#dda0dd"],
		[25, "光环", function (enemy) { return "光环异兽的身周总是围着一群异兽，并且个个都看起来很亢奋。" + (enemy.zoneSquare ? "\n自身九宫格范围内敌人生命提升\r[#87CEFA]" : "\n\r[yellow]同楼层所有敌人\r生命提升\r[#87CEFA]") + (enemy.value || 0) + "%\r，攻击提升\r[#87CEFA]" + (enemy.atkValue || 0) + "%\r，防御提升\r[#87CEFA]" + (enemy.defValue || 0) + "%\r，" + (enemy.add ? "可叠加。" : "不可叠加。"); }, "#e6e099", 1],
		[26, "无畏守护", "以身为盾，无畏地面对任何企图伤害其守护对象的敌人。\n当\r[#87CEFA]5*5\r范围内的其他敌人受到攻击时，该敌人将上前支援，并组成\r[yellow]战斗阵列（阵列下，角色同时面对多个敌人攻击，需要按原怪→守护怪的顺序击倒每个敌人）\r进行战斗。", "#77c0b6", 1],
		[27, "捕捉", "黑白无常来抓萝莉控了！\n进入\r[yellow]敌人周围十字\r范围时会\r[yellow]强制\r进行战斗。", "#c0ddbb"],
		[29, "回风", "借助风元素的势进行的二段不对等打击。\n敌人每回合以\r[#87CEFA]0.8、1.2倍\r攻击\r[yellow]各攻击一次\r。", "#8ed1a6"],
		[30, "反转", "微妙的战斗领悟，使用诡异的战法，为攻守双方带来全新的策略维度。\n战斗中，角色\r[yellow]攻击与防御效力交换\r。", "#FFC0CB"],
		[32, "分裂", "拥有两种能力的战斗法师。\n敌人每回合额外造成\r[#87CEFA]1倍\r攻击力的魔法伤害，且当\r[yellow]角色防御超过防杀临界\r时，多余的防御将\r[yellow]正常减免\r该伤害。", "#8ea5d1"],
		[33, "牵制", "牵制对手的招式可能成为窍门或是负累。\n敌人每回合伤害*\r[#87CEFA]（敌人防御力/角色防御力）\r。", "#25c1d9"],
		[34, "散华", "奇妙的能力，感应血气并作用于攻击。\n角色攻击的效力削弱（敌人生命/角色生命）的\r[#87CEFA]十分之一\r。", "#d68e53"],
		[35, "灵闪", "光元素领悟。以快而强大的进攻压制对手。\n当\r[yellow]角色的攻击（计算加成）少于敌人\r时，敌人受到的伤害比例减少\r[#87CEFA]（敌人防御/角色防御）的二分之一\r。", "#f2ec41"],
		[36, "异界之门", "时元素领悟。触及了一丝命运规律的领悟，张开的黑暗之门似通向另一个世界。\n敌人的战斗回合数\r[#87CEFA]平方化\r。", "#808080"],
		[37, "疾走", "这个敌人出手快而敏捷。\n敌人首先发动一次\r[#87CEFA]3连击\r。", "#5dc44b"],
		[38, "饮剑", "将炽烈的进攻元素吸收并化为自身的能力。\n敌人的生命增加角色攻击的\r[#87CEFA]5倍\r。", "#f0a078"],
		[39, "同调", "玄妙且具备威胁的领悟，可以共享属性。\n敌人会随着角色的变强而变强，其攻防附加\r[#87CEFA]10%\r角色的攻防。"],
		[40, "衰弱", "用毒魔法弱化对手的能力。\n与该敌人战斗时，角色的攻防效力削弱\r[#87CEFA]10%\r。", "#f2a4e8"],
		[41, "撕裂", "这个敌人攻击非常凶猛，造成了撕裂效果。\n敌人的战斗伤害增加\r[#87CEFA]一半\r。", "#A52A2A"],
		[42, "斩阵", "看起来很像虚张声势的剑阵。\n敌人布下诡秘的杀阵，在战斗进行到第\r[#87CEFA]五、十、十五\r回合时，分别对角色造成\r[#87CEFA]1倍、2倍、4倍\r敌人攻击力的穿透伤害。", "#5279B7"],
		[43, "天剑", "可将天地能量汇聚于自身的攻势进行战斗。\n敌人每回合额外造成自身攻击\r[#87CEFA]3倍\r与角色防御\r[#87CEFA]2倍\r差值的伤害。", "#9B8AFC"],
		[44, "时封", "时元素领悟。短暂延缓自身周围区域内时间的流速，为某些关键时刻创造机会。\n战斗伤害变为\r[#87CEFA]（回合数+1）倍\r。", "#917881"],
		[45, "绝世", "五连绝世。\n战斗前，敌人以0.9倍的攻击力发动一次\r[#87CEFA]5连击\r。", "#DCF27B"],
		[46, "惑幻", "制人于幻境中，受到幻境的蛊惑。\n战斗前，角色自残\r[#87CEFA]3回合\r。", "#B20EB2"],
		[47, "凌弱", "欺凌弱小的敌人容易被防杀。\n当角色\r[yellow]防御小于敌人\r时，其\r[yellow]与敌人防御的差值\r将拉大\r[#87CEFA]一倍\r。", "#109996"],
		[48, "反戈", "反戈一击。\n敌人将角色伤害的\r[#87CEFA]20%\r反弹给角色。", "#D3A547"],
		[49, "柔骨", "接下攻击，并化为另一种劲力发回。\n战斗时，角色的攻击效力转移\r[#87CEFA]10%\r到防御上。", "#2CBA3A"],
		[50, "饮盾", "将刚猛的防守元素吸收并化为自身的能力。\n敌人的生命增加角色防御的\r[#87CEFA]5倍\r。", "#3C6794"],
		[51, "回春", "木元素领悟。修习了战复魔法的冒险者钟爱的属性。\n敌人每回合恢复自身战前生命值\r[#87CEFA]3%\r的生命，且\r[yellow]恢复的总回合数不超过原本的回合数\r。", "#CCFF99"],
		[52, "冰符咒", "由传说中的最强妖精创造的符咒，虽然她的生命力并不如何高。\n在第99回合施展冰符咒，额外造成20倍攻击力的魔法伤害。", "#6699FF"],
		[53, "折影剑", "将自身与对手的能量波动，化为数道剑影重叠在剑上。\n敌人的攻击力增加角色的\r[#87CEFA]攻防之和\r。", "#CCCCFF"],
		[54, "禁制", "修习了战复魔法的冒险者厌恶的属性。\n敌人的伤害不小于0。", "#727C87"],
		[55, "恶魔烧酒", "你在看什么啊，走开变态！尤其是你，神哥！不许看！\n以两倍攻击力进攻，无视对手防御，并附带相当于对手五分之一攻防和的水魔法伤害。\n面对高于自己三个以上境界的对手，额外追加一倍攻击力，水魔法伤害翻倍，并削弱对手96%的攻击力。", "#e075db"],
		[56, "袭杀者", "真正的刺客，是会假扮成法师的外貌的。\n抢下先手并发动一次流血突刺，削弱对手30%攻防，并造成40万点固定伤害。", "#bf5722"],
		[57, "血火囚牢", "无情的生机掠夺者。\n战斗前\r[yellow]造成对方生命10%的真实伤害\r，并构建囚牢，封住对方\r[#87CEFA]350回合\r的行动。", "#DC143C"],
		[58, "长夜无光", "那个人终会迷失在妄自撕裂自身血肉的幻觉里。\n使对方陷入仿若真实的幻境，混乱30回合，并打上血之烙印，受到的伤害加倍。", "#2F4F4F"],
		[59, "匙弱·黄", "这个敌人似乎对黄钥匙十分敏感。\n角色每拥有\r[#87CEFA]1把\r黄钥匙，该敌人伤害减少\r[#87CEFA]3%\r。", "#dfe650"],
		[60, "无力·破", "这个敌人非常惧怕强大的破墙镐。\n角色每拥有\r[#87CEFA]1把\r破墙镐，该敌人生命减少\r[#87CEFA]5%\r。", "#89f562"],
		[61, "飓风", "这个敌人迅疾如风，引动了天地间的风元素异象。\n敌人首先发动一次\r[#87CEFA]20连击\r。", "#377d3d"],
		[62, "自爆", "强者在绝望之下最后的尊严。\n第200回合触发，立即死亡，对角色造成\r[#87CEFA]自身剩余生命*4\r的伤害。", "#597a80"],
		[63, "冰封万里", function (enemy) { return "冰元素领悟。天地茫茫，纯然一色，包容一切。\n战斗前冻结对手\r[#87CEFA]" + (enemy.n || 0) + "\r回合行动，且每回合对对手造成自身攻击的160%与防御的40%之和的冰冻伤害。该技能效果可被生命减免，每\r[#87CEFA]" + (enemy.atkValue || 0) + "\r点生命可免除1回合冰冻，并减免0.1%伤害。" }, "#6e43f0"],
		[64, "圣阵", "才德全尽谓之圣人，十圆无缺谓之圣阵。\n敌人布下圣阵，在战斗进行到第\r[#87CEFA]五十、一百、二百\r回合时，分别对角色造成\r[#87CEFA]3倍、9倍、27倍\r角色与敌人攻防之和的穿透伤害。", "#d9964a"],
		[65, "执着", "铁杵磨成针。\n敌人每回合额外对角色造成角色生命千分之一的伤害。", "#cbb2d9"],
		[66, "和光同尘", "挫其锐，解其纷，和其光，同其尘。如春风般和煦，夏花般绚烂。\n战斗开始时以周围3*3方形内的事件数量为基准，每有1个事件，则每回合额外回复3000万点生命。", "#82e065"],
		[67, "召唤", "群居生物同心协力的体现。\n战斗结束后，在角色\r[yellow]十字范围内的所有空地上\r召唤\r[#87CEFA]【紫锈胎人】\r\r[yellow]（无经验）\r，围困角色。", "#F5DEB3"],
		[68, "匙弱·蓝", "这个敌人似乎对蓝钥匙十分敏感。\n角色每拥有\r[#87CEFA]1把\r蓝钥匙，该敌人伤害减少\r[#87CEFA]3%\r。", "#4f80db"],
		[69, "追光", "光元素领悟。这个敌人快得恍若一道照亮世界的光。\n敌人首先发动一次\r[#87CEFA]150连击\r。", "#ecff17"],
		[70, "召唤", "群居生物同心协力的体现。\n战斗结束后，在角色\r[yellow]十字范围内的所有空地上\r召唤\r[#87CEFA]【舰船除草机B1】\r\r[yellow]（有经验）\r，围困角色。", "#F5DEB3"],
		[71, "10回合", "在敌人的手中走过十回合！", "#624fdb"],
		[72, "匙弱·黄Ⅱ", "这个敌人似乎对黄钥匙十分敏感。\n角色每拥有\r[#87CEFA]1把\r黄钥匙，该敌人伤害减少\r[#87CEFA]2%\r。", "#dfe650"],
		[73, "匙弱·蓝Ⅱ", "这个敌人似乎对蓝钥匙十分敏感。\n角色每拥有\r[#87CEFA]1把\r蓝钥匙，该敌人伤害减少\r[#87CEFA]2%\r。", "#4f80db"],
		[74, "冰封术", function (enemy) { return "冰元素领悟。可以让人瞬间变成冰块的术式，唯有蓬勃的生命得以顽强生长。\n战斗前, 冻结角色\r[#87CEFA]" + (enemy.n || 0) + "\r回合行动。该技能效果可被生命减免，每\r[#87CEFA]" + (enemy.atkValue || 0) + "\r点生命可免除1回合冰冻。"; }, "#74e3d4"],
		[75, "冰凌剑", function (enemy) { return "冰元素领悟。可以将冰元素变换为剑形态，刺穿对手的术式，唯有坚不可摧的护盾方可抵挡。\n战斗前, 对角色造成相当于角色攻防和\r[#87CEFA]百倍\r的固定伤害。该技能效果可被护盾减免，每\r[#87CEFA]" + (enemy.atkValue || 0) + "\r点护盾可减免\r[#87CEFA]0.05%\r伤害。"; }, "#87CEEB"],
		[76, "冻伤", function (enemy) { return "冰元素领悟。让对手在低温中感受到难以言喻的痛苦，强大的体魄是镇痛的必要条件。\n战斗前, 对角色造成相当于角色护盾\r[#87CEFA]百倍\r的固定伤害。该技能效果可被攻防和减免，每\r[#87CEFA]" + (enemy.atkValue || 0) + "\r点攻防和可减免\r[#87CEFA]0.05%\r伤害。"; }, "#97c6e8"],
		[77, "百线流", "？？？", "#00FA9A"],
		[78, "金空法则", "？？？", "#edec9f"],
		[79, "压制", "压制对手的招式可能成为窍门或是负累。\n敌人每回合伤害*\r[#87CEFA]（敌人攻防和/角色攻防和）\r。", "#e3e647"],
		[80, "生命限制", "限制对手的招式可能成为窍门或是负累。\n敌人每回合伤害*\r[#87CEFA]（敌人生命/角色生命）\r。", "#eb7fb5"],
		[81, "贪婪", "七原罪之一，贪欲永远无法被填满。\n战斗结束后，在\r[yellow]【左阿】朝向左右两边及前边的空地上重生，且重生后的怪物将会强化\r。", "#acd6a0"],
		[82, "匙强·黄", "这个敌人似乎对黄钥匙过敏。\n角色每拥有\r[#87CEFA]1把\r黄钥匙，该敌人伤害增加\r[#87CEFA]0.1%\r，且当匙弱属性降伤达\r[#87CEFA]100%\r时，该属性直接失效。", "#dfe650"],
		[83, "匙强·蓝", "这个敌人似乎对蓝钥匙过敏。\n角色每拥有\r[#87CEFA]1把\r蓝钥匙，该敌人伤害增加\r[#87CEFA]0.1%\r，且当匙弱属性降伤达\r[#87CEFA]100%\r时，该属性直接失效。", "#4f80db"],
		[84, "怠惰", "七原罪之一，怠惰是人类的天性。\n战斗结束后，在\r[yellow]角色朝向左右两边及后边的空地上制造一格墙体\r。", "#FFF8DC"],
		[85, "死线", "不要忘记那些不得不做的事情。\n战斗结束后，使角色生命变为原来的\r[#87CEFA]1/5\r，下次战斗后\r[yellow]返还扣除的生命\r。", "#DCDCDC"],
		[86, "吹火掌", "火、空元素领悟。穹斗世界古书中记载的某种斗技，控制与对手的距离。\n战斗结束后，将角色推至\r[yellow]身后最远距离的空地\r上。\r[yellow](该过程不触发地图伤害及技能)\r", "#f55882"],
		[87, "潜伏", "你看不到我，看不到我……诶？\n怪物在地图上为\r[yellow]可通行的隐身状态\r，\r[yellow]穿过怪物\r后回归正常。", "#efe4f0"],
		[88, "败移", "空元素领悟。战斗后，若怪物身后有其他怪物存在，则与\r[yellow]最近的一只\r怪物互换位置。\r[yellow]（获得资源需彻底杀死怪物）\r", "#32CD32"],
		[89, "求援", "该怪物受到攻击时，将召唤\r[yellow]九宫格范围内\r\r[#87CEFA]1格\r\r[yellow]、十字范围内\r\r[#87CEFA]2格\r的敌人来到\r[yellow]自身位置\r支援。\r[yellow]（战斗伤害分别计算）\r", "#77c0b6"],
		[90, "硬化", "当角色攻击大于防御时，怪物将\r[yellow]无视超出部分的攻击数值\r。", "#94478a"],
		[91, "小队", "小队成员为了生存而聚集在一起战斗。\n由2-50个单位组成的小队。", "#584af0"],
		[92, "大队", "大队成员气势汹汹，欲杀死所有阻拦自己的敌人。\n由100-5000个单位组成的大队。", "#d532eb"],
		[93, "战团", "一个成组织战斗的集体。他们观察敌情，发现敌方境界并不高，而且人数并不多，所以他们开始了战斗。\n由1万-100万个单位组成的战团。", "#f527d3"],
		[94, "军团", "一个成熟的军事集团。战争已经发生了很多次，但是从未停止过，它们就像是一群眼中只有胜利的野兽。\n由1000万个以上单位组成的军团。", "#eeff38"],
		[95, "血杀", "你曾为自己的使命流过多少血？\n当\r[yellow]角色生命多于敌人\r时，敌人伤害\r[#87CEFA]增加一半\r，反之\r[#87CEFA]减少一半\r。", "#ed374f"],
		[96, "生机限制", "限制对手的招式可能成为窍门或是负累。\n敌人计算护盾后的总伤害*\r[#87CEFA]（敌人生命/角色生命）\r。", "#eb7fb5"],
		[97, "禁制", "别想偷偷把圣水拿走！\n当敌人存在于本层时，高阶道具\r[#87CEFA]磁吸石、十字标靶\r被限制使用。", "#808080"],
		[98, "帝阵", "以傲然的姿态帝临于世间。\n敌人布下帝阵，在战斗进行到第\r[#87CEFA]二百、四百、八百\r回合时，分别对角色造成\r[#87CEFA]4倍、32倍、128倍\r角色与敌人攻防之和的穿透伤害。", "#f55b39"],
		[99, "士气-燕：能", "你的意志来源于何处？你为之而战斗的动机……是什么？\n具有该属性的敌人每被击败一个，其他所有该属性敌人的能力下降\r[yellow]0.3%\r。", "#9cfc60"],
		[100, "士气-燕：命", "你的意志来源于何处？你为之而战斗的动机……是什么？\n具有该属性的敌人每被击败一个，其他所有该属性敌人的生命下降\r[yellow]1%\r。", "#eefc72"],
		[101, "极冲", "极限充能已开启！请有序将大脑存放在此处！\n战斗前，敌人以0.9倍的攻击力发动一次\r[#87CEFA]233连击\r。", "#3c0ce8"],
		[102, "士气-魈：攻", "傀儡师的得意之作。\n具有该属性的敌人每被击败一个，其他所有该属性敌人的攻击下降\r[yellow]3%\r。", "#db4f69"],
		[103, "士气-魈：命", "傀儡师的得意之作。\n具有该属性的敌人每被击败一个，其他所有该属性敌人的生命下降\r[yellow]5%\r。", "#eefc72"],
		[105, "士气-魈：防", "傀儡师的得意之作。\n具有该属性的敌人每被击败一个，其他所有该属性敌人的防御下降\r[yellow]3%\r。", "#4f90db"],
		[106, "守护", "忠诚而可悲的守护者。\n\r[yellow]当场上存在战傀儡时，【魈】的本体伤害*1.5。\r", "#706a7d"],
		[111, "叛逆", "令人怒不可遏的叛逆者。\n\r……？\r", "#706a7d"],
		[112, "恃强", "只会向示弱者抽刃的伪强者是不值一提的。\n当角色攻防和少于敌人时，敌人额外具备\r[#87CEFA]魔攻\r属性。", "#8af2c7"],
		[113, "反物质", "暗元素领悟。催动反物质倒转周遭空间的能量运作方式。\n战斗后，角色\r[yellow]攻击与防御效力交换\r，效果持续\r[#87CEFA]2场\r战斗。", "#c4aebf"],
		[114, "灰霾云", "暗元素领悟。与空间中蕴藏的暗物质深度链接，笼罩对手，令人没来由地感受到暴戾的情绪。\n战斗后，角色攻防效力\r[#87CEFA]+5%\r，同时\r[#87CEFA]魔防清零\r，效果持续\r[#87CEFA]2场\r战斗。\r[#87CEFA]（攻防提升上限：30兆。）\r", "#919ba6"],
		[115, "亡灵仇契", "孤魂野鬼们通过特定仪式达成的隐形契约，即使死亡也不会消散而去。\n具有该属性的\r[yellow]同种\r敌人每被击败一个，其他所有\r[yellow]同种\r敌人的能力上升\r[#87CEFA]4%\r。", "#88ad95"],
		[116, "亡灵仇契", "孤魂野鬼们通过特定仪式达成的隐形契约，即使死亡也不会消散而去。\n具有该属性的\r[yellow]同种\r敌人每被击败一个，其他所有\r[yellow]同种\r敌人的能力上升\r[#87CEFA]4%\r。", "#88ad95"],
		[117, "叠影袭", "暗元素领悟。将暗元素结成的刀刃之影相叠，造成可怕的杀伤力。\n敌人每\r[#87CEFA]10回合\r发动一次\r[#87CEFA]10倍伤害\r的暴击。", "#568774"],
		[118, "大撕裂", "这个敌人的攻击凶残得似乎要撕碎对方的灵魂。\n敌人的战斗伤害翻\r[#87CEFA]4倍\r。", "#ab0909"],
		[119, "浊化", "这个怪物死气沉沉的，好像很害怕代表生命力量的护盾。\n护盾对该怪物的效力为\r[#87CEFA]10倍\r。", "#88ad95"],
		[120, "水棱镜", "水元素领悟。张开一面晶莹剔透，平滑如镜的水属性结界，扭曲光线与能量。\n战斗后令角色与怪物的回合伤害都\r[yellow]减去角色护盾的\r\r[#87CEFA]0.5%\r\r[yellow]（回合伤害最小值为0）\r，效果持续\r[#87CEFA]2场\r战斗。\r[yellow]（角色魔攻不受该效果影响）\r", "#6260f0"],
		[121, "水心盾", "水元素领悟。以至纯的水元素凝结形成盾牌，似有潺潺的流水在其中流淌。\n战斗后令角色与怪物同时增加\r[#87CEFA]2层\r\r[yellow]等同于角色护盾值的护盾\r，效果持续\r[#87CEFA]2场\r战斗。", "#72e8e6"],
		[122, "惊风", "风元素领悟。以己身为风眼，形成坚不可摧的风暴领域，以雷霆一般的攻势毁灭对手。\n敌人首先发动一次\r[#87CEFA]1200连击\r，且护盾减免该技能伤害的效果为\r[#87CEFA]10倍\r。", "#a5faaa"],
		[123, "七叶天舞", "风元素领悟。融合自然天地间的风元素威能，召唤77片风之叶环绕身遭，形成复杂玄奥的风元素风暴，与天地合为一体，其势不可阻挡！\n敌人每回合攻击\r[#87CEFA]77次\r，且战斗伤害*（1/(1000-回合数)）。当回合数≥1000时，战斗伤害不变。", "#9ef229"],
		[124, "大惑幻", "编织恍若真实世界的幻境，久困敌人于内，使敌人的意志彻底磨灭。\n战斗前，角色自残\r[#87CEFA]300回合\r。", "#d417ff"],
		[125, "灼心之星", "火元素领悟。以对方力量之中蕴含的火元素为引，点燃炽烈的火焰，仿若一颗微型的超新星燃烧，焚尽周围的一切。\n敌人每回合伤害*\r[#87CEFA]（敌人攻击/角色攻击）^2\r。", "#ff6600"],
		[126, "亡灵仇契", "孤魂野鬼们通过特定仪式达成的隐形契约，即使死亡也不会消散而去。\n具有该属性的\r[yellow]同种\r敌人每被击败一个，其他所有\r[yellow]同种\r敌人的能力上升\r[#87CEFA]8%\r。", "#88ad95"],
		[127, "无力·飞", "这个敌人非常惧怕强大的飞行器。\n角色每拥有\r[#87CEFA]1个\r中心对称飞行器，该敌人生命减少\r[#87CEFA]5%\r。", "#89f562"],
		[128, "焰落焚天", "火元素领悟。燃着己身，点燃一场纯粹火元素席卷而起的风暴，自天而降数之不尽的火焰之雨，火雨覆盖的广阔区域皆被高温所炙烤扭曲。\n敌人抽取角色\r[#87CEFA]1%\r的攻击力，每\r[#87CEFA]5回合\r造成\r[yellow]该数值与总回合数乘积\r的伤害，同时敌人受到的回合伤害\r[yellow]翻倍\r。", "#ebac86"],
		[129, "草木常青", "木元素领悟。青青野草，生生不息。\n敌人每回合恢复自身\r[yellow]战前生命值0.05%与总回合数之积\r的生命，且\r[yellow]恢复的总回合数不超过原本的回合数\r。", "#CCFF99"],
		[130, "慕强击弱", "比下位技能更奇怪的是，这个敌人本身并不强大，强大的是他头上的帽子……\n当角色\r[yellow]防御小于敌人的\r\r[#87CEFA]2.5倍\r时，其\r[yellow]与敌人防御2.5倍化后的差值\r将拉大\r[#87CEFA]2倍\r。", "#109996"],
		[131, "封锁", "哼哼，你以为你现在还走得掉嘛？\n当敌人存在于本层时，\r[#87CEFA]楼层传送器\r被限制使用。", "#808080"],
		[132, "门阵·黄", "空元素领悟。与门产生协同效力，封锁空间。\n本层每多一扇\r[#87CEFA]黄色骷髅门\r，敌人三围属性+5%。", "#808080"],
		[133, "门阵·蓝", "空元素领悟。与门产生协同效力，封锁空间。\n本层每多一扇\r[#87CEFA]蓝色骷髅门\r，敌人三围属性+5%。", "#808080"],
		[134, "相克·水", "万物有灵，相生相克。\n每击败一个\r[yellow]水之镇守\r，其元素能量被\r[#66ccff]时光殿的未知力量\r吸收，怪物伤害\r[#87CEFA]-5%\r。", "#80c9ed"],
		[135, "相克·光", "万物有灵，相生相克。\n每击败一个\r[yellow]光之镇守\r，其元素能量被\r[#66ccff]时光殿的未知力量\r吸收，怪物伤害\r[#87CEFA]-5%\r。", "#e2ed80"],
		[136, "相克·火", "万物有灵，相生相克。\n每击败一个\r[yellow]火之镇守\r，其元素能量被\r[#66ccff]时光殿的未知力量\r吸收，怪物伤害\r[#87CEFA]-5%\r。", "#FFB6C1"],
		[137, "相克·木", "万物有灵，相生相克。\n每击败一个\r[yellow]木之镇守\r，其元素能量被\r[#66ccff]时光殿的未知力量\r吸收，怪物伤害\r[#87CEFA]-5%\r。", "#7FFF00"],
		[138, "相克·暗", "万物有灵，相生相克。\n每击败一个\r[yellow]暗之镇守\r，其元素能量被\r[#66ccff]时光殿的未知力量\r吸收，怪物伤害\r[#87CEFA]-5%\r。", "#DCDCDC"],
		[139, "追杀", "杀杀杀杀杀杀！！！\n当敌人与角色\r[yellow]在一条直线上且无墙体遮挡\r时，敌人会向角色\r[yellow]靠近一格\r。", "#e8dbae"],
		[140, "四方分裂阵", "蕴含一丝空之法则的领悟。身化亿万，洒落岁月，经历时空的熬炼。\n战斗结束后，在角色的\r[yellow]八个方向，距离为\r[#87CEFA]2\r的所有空地上复制自身\r，围困角色。", "#F5DEB3"],
		[141, "自然之笙", "木元素领悟。操纵自然之中的元素能量，凝结笙箫之形，爆发出强大的能量音波，感染对手使其进入防守姿态。\n战斗时，角色\r[yellow]对怪物造成的回合伤害\r[#87CEFA]减半\r\r，同时\r[#87CEFA]防御+20%\r。该效果将\r[yellow]延续到战斗后\r，并持续\r[#87CEFA]2场\r战斗。\r[#87CEFA]（防御提升上限：10京。）\r", "#4fb009"],
		[142, "伤痕舞步", "火元素领悟。狂热而咄咄逼人的战斗步法，融汇火元素的凶戾，舍弃部分防守而全力以赴进攻，以血换血，以伤换伤。\n战斗时，怪物攻击效力\r[#87CEFA]+50%\r，同时角色攻击效力\r[#87CEFA]+20%\r。该效果将\r[yellow]延续到战斗后\r，并持续\r[#87CEFA]2场\r战斗。\r[#87CEFA]（攻击提升上限：50京。）\r", "#c75e02"],
		[143, "溯回间", "时元素领悟。强大的战术术式，在对手身遭创造时间回溯之间，将自身的状态施以其中，对回溯之间内的未来施加影响。\n战斗后，留下时间标记，并使角色下次\r[yellow]战斗伤害\r[#87CEFA]增加一半\r\r。但如果\r[yellow]下次战斗目标仍具有该属性\r，则引起反噬，并使角色\r[yellow]战斗伤害\r[#87CEFA]减少四分之三\r\r。", "#e8e3c1"],
		[144, "亡灵仇契", "孤魂野鬼们通过特定仪式达成的隐形契约，即使死亡也不会消散而去。\n具有该属性的\r[yellow]同种\r敌人每被击败一个，其他所有\r[yellow]同种\r敌人的战斗伤害上升\r[#87CEFA]50%\r。", "#88ad95"],
		[145, "解禁术", "空元素领悟。利用对空间结构的解读将元素门的能量消解，不受空间之中的元素门限制。\n战斗时，\r[#87CEFA]角色九宫格范围\r内的门将被打开，且不消耗钥匙。", "#5eb5c4"],
		[146, "空间坍塌", "空元素领悟。在目标区域内破坏空元素平衡，引发大坍塌摧毁其中的物质。\n战斗时，\r[#87CEFA]角色九宫格范围\r内的\r[yellow]一切地形、怪物、资源\r将被破坏消失。", "#ba6ab5"],
		[147, "大坚固", "土元素领悟。继承厚土的伟力，牢固、坚定、不可破坏。\n敌人防御不小于\r[#87CEFA]角色攻击*1.1\r。", "#c0b088"],
		[148, "能力压制", "压制对手的招式可能成为窍门或是负累。\n敌人计算护盾后的总伤害*\r[#87CEFA]（敌人攻防和/角色攻防和）\r。", "#e3e647"],
		[149, "火空法则", "？？？", "#f5828d"],
		[150, "远古叹息", "？？？", "#18140f"],
		[152, "新属性", "？？？", "#18140f"],
		[153, "音爆【十字】", "独特的音乐领悟，偏向于空之法则。基于音未神留下的音阶理论，经由幻音世界后世改良与流传，通过特定的音波传递方式，在形如十字的空间结构中激发音乐的和谐与力量。\n战斗中，敌人施展秘术，每回合出手\r[#87CEFA]50次\r，音波将使\r[yellow]角色十字范围3格内的敌人损失\r[#87CEFA]一半\r生命。\r\r[yellow]（怪物离开原来的点位后失效）\r", "#ff8299"],
		[154, "音爆【九宫格】", "独特的音乐领悟，偏向于空之法则。基于音未神留下的音阶理论，经由幻音世界后世改良与流传，通过特定的音波传递方式，利用布局原理，在九宫格空间中爆发出富有冲击力的声波。\n战斗中，敌人施展秘术，每回合出手\r[#87CEFA]50次\r，音波将使\r[yellow]角色九宫格范围内及上下左右第二格的敌人损失一半生命。\r\r[yellow]（怪物离开原来的点位后失效）\r", "#ff8299"],
		[155, "亡灵仇契", "孤魂野鬼们通过特定仪式达成的隐形契约，即使死亡也不会消散而去。\n具有该属性的\r[yellow]同种\r敌人每被击败一个，其他所有\r[yellow]同种\r敌人的攻击上升\r[#87CEFA]10%\r，防御上升\r[#87CEFA]5%\r。", "#88ad95"],
		[156, "光影复生", "蕴含一丝时之法则的领悟。在有限的空间内制造时光逆流，令某个个体短暂过去时间内的经历与场景重现。\n战斗后，角色\r[yellow]被传送到上一层楼的当前位置\r。", "#ff6600"],
		[157, "灰霾云Ⅱ", "蕴含一丝光之法则的领悟。与空间中蕴藏的暗物质深度链接，笼罩对手，令人没来由地感受到暴戾的情绪。\n战斗后，角色攻防效力\r[#87CEFA]+10%\r，同时\r[#87CEFA]魔防清零\r，效果持续\r[#87CEFA]3场\r战斗。\r[#87CEFA]（攻防提升上限：500京。）\r", "#919ba6"],
		[158, "十字坍塌", "空元素领悟。在目标区域内破坏空元素平衡，引发大坍塌摧毁其中的物质。\n战斗时，\r[#87CEFA]角色十字范围2格\r内的\r[yellow]一切地形、怪物、资源\r将被破坏消失。", "#ba6ab5"],
		[159, "四方分裂阵", "蕴含一丝空之法则的领悟。身化亿万，洒落岁月，经历时空的熬炼。\n战斗结束后，在角色的\r[yellow]八个方向，距离为\r[#87CEFA]2\r的所有\r[yellow]非不可通行地块\r上复制自身\r，围困角色。", "#F5DEB3"],
		[160, "大灵体", function (enemy) { return "以特殊的生命形式而存在。\r敌人对角色造成\r[#87CEFA]" + (enemy.damage || 0) + "\r点固定伤害，该伤害可被护盾减免，减免效果为护盾的\r[#87CEFA]99倍\r；当角色护盾达到该伤害的\r[#87CEFA]1%\r时，\r[yellow]灵体失效\r。"; }, "#ff9977"],
		[161, "迟缓", "敌人进攻速度很慢，但同时也意味着其拥有更独特之处。\n敌人每\r[#87CEFA]2回合\r攻击一次。", "#ffee77"],
		[162, "自爆", "强者在绝望之下最后的尊严……？\n第20回合触发，立即死亡，对角色造成\r[#87CEFA]自身剩余生命*4\r的伤害。", "#597a80"],
		[999, "绿钥匙", "咸！咸！咸！\n击败敌人后，绿钥匙数量-1。", "#008000"],

	];

},
        "getEnemyInfo": function (enemy, hero, x, y, floorId) {
	// 获得某个怪物变化后的数据；该函数将被伤害计算和怪物手册使用
	// 例如：坚固、模仿、仿攻等等
	// 
	// 参数说明：
	// enemy：该怪物信息
	// hero_hp,hero_atk,hero_def,hero_mdef：勇士的生命攻防护盾数据
	// x,y：该怪物的坐标（查看手册和强制战斗时为undefined）
	// floorId：该怪物所在的楼层
	// 后面三个参数主要是可以在光环等效果上可以适用（也可以按需制作部分范围光环效果）
	floorId = floorId || core.status.floorId;
	var hero_hp = core.getRealStatusOrDefault(hero, 'hp'),
		hero_atk = core.getRealStatusOrDefault(hero, 'atk'),
		hero_def = core.getRealStatusOrDefault(hero, 'def'),
		hero_mdef = core.getRealStatusOrDefault(hero, 'mdef');

	var mon_hp = core.getEnemyValue(enemy, 'hp', x, y, floorId),
		mon_atk = core.getEnemyValue(enemy, 'atk', x, y, floorId),
		mon_def = core.getEnemyValue(enemy, 'def', x, y, floorId),
		mon_special = core.getEnemyValue(enemy, 'special', x, y, floorId);
	var mon_money = core.getEnemyValue(enemy, 'money', x, y, floorId),
		mon_exp = core.getEnemyValue(enemy, 'exp', x, y, floorId),
		mon_point = core.getEnemyValue(enemy, 'point', x, y, floorId);
	// 模仿
	if (core.hasSpecial(mon_special, 10)) {
		mon_atk = hero_atk;
		mon_def = hero_def;
	}
	// 破墙
	if (core.hasSpecial(mon_special, 60)) {
		mon_hp *= 1 - (core.itemCount("pickaxe") * 0.05);
	}
	// 飞行
	if (core.hasSpecial(mon_special, 127)) {
		mon_hp *= 1 - (core.itemCount("centerFly") * 0.05);
	}
	// 坚固
	if (core.hasSpecial(mon_special, 3) && mon_def < hero_atk - 1) {
		mon_def = hero_atk - 1;
	}

	// 大坚固
	if (core.hasSpecial(mon_special, 147) && mon_def < hero_atk * 1.1) {
		mon_def = hero_atk * 1.1;
	}

	// 同调
	var mon_atk1 = mon_atk;
	var mon_def1 = mon_def;
	if (core.hasSpecial(mon_special, 39)) {
		mon_atk = mon_atk1 + hero_atk * 0.1;
		mon_def = mon_def1 + hero_def * 0.1;
	}
	// 饮剑
	if (core.hasSpecial(mon_special, 38)) {
		mon_hp += hero_atk * 5;
	}

	// 饮盾
	if (core.hasSpecial(mon_special, 50)) {
		mon_hp += hero_def * 5;
	}

	// 预言者
	if (core.hasItem('I596')) {
		var yuyan = Math.ceil(mon_hp / Math.max(hero_atk - mon_def, 0));
		if (yuyan > 200) yuyan = 200;
		mon_hp *= 1 - (yuyan * 0.0015)
	}
	// 预言者2
	if (core.hasItem('I832')) {
		var yuyan = Math.ceil(mon_hp / Math.max(hero_atk - mon_def, 0));
		if (yuyan > 200) yuyan = 200;
		mon_hp *= 1 - (yuyan * 0.0018)
	}
	// 预言者3
	if (core.hasItem('I833')) {
		var yuyan = Math.ceil(mon_hp / Math.max(hero_atk - mon_def, 0));
		if (yuyan > 200) yuyan = 200;
		mon_hp *= 1 - (yuyan * 0.0021)
	} // 预言者4
	if (core.hasItem('I834')) {
		var yuyan = Math.ceil(mon_hp / Math.max(hero_atk - mon_def, 0));
		if (yuyan > 250) yuyan = 250;
		mon_hp *= 1 - (yuyan * 0.0021)
	} // 预言者5
	if (core.hasItem('I835')) {
		var yuyan = Math.ceil(mon_hp / Math.max(hero_atk - mon_def, 0));
		if (yuyan > 300) yuyan = 300;
		mon_hp *= 1 - (yuyan * 0.0021)
	} // 预言者6
	if (core.hasItem('I836')) {
		var yuyan = Math.ceil(mon_hp / Math.max(hero_atk - mon_def, 0));
		if (yuyan > 300) yuyan = 300;
		mon_hp *= 1 - (yuyan * 0.0025)
	}

	// 伤痕
	if (core.hasSpecial(mon_special, 142) || (core.getFlag("s142", 0) > 0)) {
		mon_atk *= 1.5;
	}

	// 折影剑
	if (core.hasSpecial(mon_special, 53)) {
		mon_atk += hero_atk + hero_def;
	}
	var guards = [];

	// 光环和支援检查
	if (!core.status.checkBlock) core.status.checkBlock = {};

	if (core.status.checkBlock.needCache) {
		// 从V2.5.4开始，对光环效果增加缓存，以解决多次重复计算的问题，从而大幅提升运行效率。
		var hp_buff = 0,
			atk_buff = 0,
			def_buff = 0;
		// 已经计算过的光环怪ID列表，用于判定叠加
		var usedEnemyIds = {};
		// 检查光环和支援的缓存
		var index = x != null && y != null ? (x + "," + y) : "floor";
		if (!core.status.checkBlock.cache) core.status.checkBlock.cache = {};
		var cache = core.status.checkBlock.cache[index];
		if (!cache) {
			// 没有该点的缓存，则遍历每个图块
			core.extractBlocks(floorId);
			core.status.maps[floorId].blocks.forEach(function (block) {
				if (!block.disable) {
					// 获得该图块的ID
					var id = block.event.id,
						enemy = core.material.enemys[id];
					// 检查【光环】技能，数字25
					if (enemy && core.hasSpecial(enemy.special, 25)) {
						// 检查是否是范围光环
						var inRange = enemy.range == null;
						if (enemy.range != null && x != null && y != null) {
							var dx = Math.abs(block.x - x),
								dy = Math.abs(block.y - y);
							// 检查十字和九宫格光环
							if (dx + dy <= enemy.range) inRange = true;
							if (enemy.zoneSquare && dx <= enemy.range && dy <= enemy.range) inRange = true;
						}
						// 检查是否可叠加
						if (inRange && (enemy.add || !usedEnemyIds[enemy.id])) {
							hp_buff += enemy.value || 0;
							atk_buff += enemy.atkValue || 0;
							def_buff += enemy.defValue || 0;
							usedEnemyIds[enemy.id] = true;
						}
					}
					// 检查【支援】技能，数字26
					if (enemy && core.hasSpecial(enemy.special, 26) &&
						// 检查支援条件，坐标存在，距离为1，且不能是自己
						// 其他类型的支援怪，比如十字之类的话.... 看着做是一样的
						x != null && y != null && Math.abs(block.x - x) <= 2 && Math.abs(block.y - y) <= 2 && !(x == block.x && y == block.y)) {
						// 记录怪物的x,y，ID
						guards.push([block.x, block.y, id]);
					}

					// TODO：如果有其他类型光环怪物在这里仿照添加检查
					//

					// 注：新增新的类光环属性（需要遍历全图的）需要在特殊属性定义那里的第五项写1，参见光环和支援的特殊属性定义。
				}
			});



			core.status.checkBlock.cache[index] = { "hp_buff": hp_buff, "atk_buff": atk_buff, "def_buff": def_buff, "guards": guards };
		} else {
			// 直接使用缓存数据
			hp_buff = cache.hp_buff;
			atk_buff = cache.atk_buff;
			def_buff = cache.def_buff;
			guards = cache.guards;
		}


		// 增加比例；如果要增加数值可以直接在这里修改
		mon_hp *= (1 + hp_buff / 100);
		mon_atk *= (1 + atk_buff / 100);
		mon_def *= (1 + def_buff / 100);
	}

	if (core.hasSpecial(mon_special, 99)) { //
		mon_atk *= 1 - 0.003 * core.getFlag("sq99", 0);
		mon_def *= 1 - 0.003 * core.getFlag("sq99", 0);
	}
	if (core.hasSpecial(mon_special, 100)) { //
		mon_hp *= 1 - 0.01 * core.getFlag("sq100", 0);
	}

	if (core.hasSpecial(mon_special, 103)) { //
		mon_hp *= 1 - 0.05 * core.getFlag("sq103", 0);
	}

	if (core.hasSpecial(mon_special, 102)) { //
		mon_atk *= 1 - 0.03 * core.getFlag("sq102", 0);
	}

	if (core.hasSpecial(mon_special, 105)) { //
		mon_def *= 1 - 0.03 * core.getFlag("sq105", 0);
	}

	if (core.hasSpecial(mon_special, 115)) { //
		mon_atk *= 1 + 0.04 * core.getFlag("sq115", 0);
		mon_def *= 1 + 0.04 * core.getFlag("sq115", 0);
	}

	if (core.hasSpecial(mon_special, 116)) { //
		mon_atk *= 1 + 0.04 * core.getFlag("sq116", 0);
		mon_def *= 1 + 0.04 * core.getFlag("sq116", 0);
	}

	if (core.hasSpecial(mon_special, 126)) { //
		mon_atk *= 1 + 0.08 * core.getFlag("sq126", 0);
		mon_def *= 1 + 0.08 * core.getFlag("sq126", 0);
	}

	if (core.hasSpecial(mon_special, 155)) { //
		mon_atk *= 1 + 0.1 * core.getFlag("sq155", 0);
		mon_def *= 1 + 0.05 * core.getFlag("sq155", 0);
	}

	// TODO：可以在这里新增其他的怪物数据变化
	// 比如仿攻（怪物攻击不低于勇士攻击）：
	// if (core.hasSpecial(mon_special, 27) && mon_atk < hero_atk) {
	//     mon_atk = hero_atk;
	// }
	// 也可以按需增加各种自定义内容


	return {
		"hp": Math.floor(mon_hp),
		"atk": Math.floor(mon_atk),
		"def": Math.floor(mon_def),
		"money": Math.floor(mon_money),
		"exp": Math.floor(mon_exp),
		"point": Math.floor(mon_point),
		"special": mon_special,
		"guards": guards, // 返回支援情况
	};
},
        "getDamageInfo": function (enemy, hero, x, y, floorId) {
	// 获得战斗伤害信息（实际伤害计算函数）
	// 
	// 参数说明：
	// enemy：该怪物信息
	// hero：勇士的当前数据；如果对应项不存在则会从core.status.hero中取。
	// x,y：该怪物的坐标（查看手册和强制战斗时为undefined）
	// floorId：该怪物所在的楼层
	// 后面三个参数主要是可以在光环等效果上可以适用
	floorId = floorId || core.status.floorId;

	var hero_hp = core.getRealStatusOrDefault(hero, 'hp'),
		hero_atk = core.getRealStatusOrDefault(hero, 'atk'),
		hero_def = core.getRealStatusOrDefault(hero, 'def'),
		hero_mdef = core.getRealStatusOrDefault(hero, 'mdef'),
		origin_hero_hp = core.getStatusOrDefault(hero, 'hp'),
		origin_hero_atk = core.getStatusOrDefault(hero, 'atk'),
		origin_hero_def = core.getStatusOrDefault(hero, 'def');

	// 勇士的负属性都按0计算
	hero_hp = Math.max(0, hero_hp);
	hero_atk = Math.max(0, hero_atk);
	hero_def = Math.max(0, hero_def);
	hero_mdef = Math.max(0, hero_mdef);


	//升华
	hero_atk *= 1 + core.itemCount("I821");
	hero_def *= 1 + core.itemCount("I821");
	hero_mdef *= 1 + core.itemCount("I821");





	if (core.hasItem('I768')) {
		hero_atk *= 0.1;
		hero_def *= 0.1;
		hero_mdef *= 0.1;
	}

	if (core.hasItem('I792')) {
		hero_atk *= 0.105;
		hero_def *= 0.105;
		hero_mdef *= 0.105;
	}

	if (core.hasItem('I793')) {
		hero_atk *= 0.13;
		hero_def *= 0.13;
		hero_mdef *= 0.13;
	}

	if (core.hasItem('I1491')) {
		hero_atk += hero_mdef * 0.003;
		hero_def += hero_mdef * 0.003;
	}

	if (core.hasItem('I1492')) {
		hero_atk += hero_mdef * 0.006;
		hero_def += hero_mdef * 0.006;
	}

	if (core.hasItem('I1493')) {
		hero_atk += hero_mdef * 0.01;
		hero_def += hero_mdef * 0.01;
	}

	//妄无
	if (core.hasItem('I729')) {
		hero_atk = hero_atk * 0.8 + hero_def * 0.2;
	}

	if (core.hasItem('I603')) { hero_mdef *= 2; }
	// 怪物的各项数据
	// 对坚固模仿等处理扔到了脚本编辑-getEnemyInfo之中
	var enemyInfo = core.enemys.getEnemyInfo(enemy, hero, x, y, floorId);
	var mon_hp = enemyInfo.hp,
		mon_atk = enemyInfo.atk,
		mon_def = enemyInfo.def,
		mon_special = enemyInfo.special;

	// 坚固
	if (core.hasSpecial(mon_special, 3) && mon_def < hero_atk - 1) {
		mon_def = hero_atk - 1;
	}

	// 大坚固
	if (core.hasSpecial(mon_special, 147) && mon_def < hero_atk * 1.1) {
		mon_def = hero_atk * 1.1;
	}


	// 吞食者
	if (core.hasItem("I597")) {
		hero_atk += mon_hp * 0.01;
		hero_def += mon_hp * 0.01;
		hero_mdef += mon_hp * 0.01;
	}
	// 吞食者
	if (core.hasItem("I837")) {
		hero_atk += mon_hp * 0.015;
		hero_def += mon_hp * 0.015;
		hero_mdef += mon_hp * 0.015;
	} // 吞食者
	if (core.hasItem("I838")) {
		hero_atk += mon_hp * 0.0007;
		hero_def += mon_hp * 0.0007;
		hero_mdef += mon_hp * 0.0007;
	} // 吞食者
	if (core.hasItem("I839")) {
		hero_atk += mon_hp * 0.000825;
		hero_def += mon_hp * 0.000825;
		hero_mdef += mon_hp * 0.000825;
	} // 吞食者
	if (core.hasItem("I840")) {
		hero_atk += mon_hp * 0.00095;
		hero_def += mon_hp * 0.00095;
		hero_mdef += mon_hp * 0.00095;
	} // 吞食者
	if (core.hasItem("I841")) {
		hero_atk += mon_hp * 0.001075;
		hero_def += mon_hp * 0.001075;
		hero_mdef += mon_hp * 0.001075;
	}

	// 衰弱
	if (core.hasSpecial(enemy.special, 40)) {
		hero_atk = Math.floor(0.9 * hero_atk);
		hero_def = Math.floor(0.9 * hero_def);
	}

	// 刺客
	if (core.hasSpecial(enemy.special, 56)) {
		hero_atk = Math.floor(0.7 * hero_atk);
		hero_def = Math.floor(0.7 * hero_def);
	}

	// 散华
	if (core.hasSpecial(mon_special, 34)) {
		hero_atk *= (1 - (mon_hp / hero_hp) / 10);
	}

	// 柔骨
	if (core.hasSpecial(mon_special, 49)) {
		hero_def += hero_atk * 0.1;
		hero_atk *= 0.9;
	}

	// 自然
	if (core.hasSpecial(mon_special, 141) || (core.getFlag("s141", 0) > 0)) {
		var nature141 = hero_def * 0.2;
		if (nature141 > 10e16) nature141 = 10e16;
		hero_def += nature141;
	}

	// 伤痕
	if (core.hasSpecial(mon_special, 142) || (core.getFlag("s142", 0) > 0)) {
		var scar142 = hero_atk * 0.2;
		if (scar142 > 50e16) scar142 = 50e16;
		hero_atk += scar142;
	}
	// 技能的处理
	if (core.getFlag('skill', 0) == 1) { // 开启了技能1：二倍斩
		hero_atk *= 2; // 计算时攻击力翻倍	
	}



	//暗1


	if (core.getFlag("s113", 0) > 0) {
		var fanzhuan = hero_def;
		hero_def = hero_atk;
		hero_atk = fanzhuan;
	}


	//暗2

	if (core.getFlag("s114", 0) > 0) {
		var cloud1141 = hero_atk * 0.05;
		var cloud1142 = hero_def * 0.05;
		if (cloud1141 > 30e12) cloud1141 = 30e12;
		if (cloud1142 > 30e12) cloud1142 = 30e12;
		hero_atk += cloud1141;
		hero_def += cloud1142;
		hero_mdef = 0
	}

	//暗3

	if (core.getFlag("s157", 0) > 0) {
		var cloud1571 = hero_atk * 0.1;
		var cloud1572 = hero_def * 0.1;
		if (cloud1571 > 500e16) cloud1571 = 500e16;
		if (cloud1572 > 500e16) cloud1571 = 500e16;
		hero_atk += cloud1571;
		hero_def += cloud1572;
		hero_mdef = 0
	}


	// 硬化
	if (core.hasSpecial(mon_special, 90) && hero_atk >= hero_def) {
		hero_atk = hero_def;
	}

	// 反转
	if (core.hasSpecial(mon_special, 30)) {
		var fanzhuan = hero_def;
		hero_def = hero_atk;
		hero_atk = fanzhuan;
	}

	// 音之力
	if (core.hasSpecial(mon_special, 151)) {
		hero_def *= 0.001;
		hero_atk *= 0.001;
		hero_mdef *= 0.001;
	}

	// 凌弱
	var mond1 = (mon_def - hero_def) * 0.5;
	if (mond1 < 0) mond1 = 0;
	if (core.hasSpecial(mon_special, 47)) {
		hero_def -= mond1;
	}

	// 凌弱2
	var mond2 = (mon_def * 2.5 - hero_def) * 0.5;
	if (mond2 < 0) mond2 = 0;
	if (core.hasSpecial(mon_special, 130)) {
		hero_def -= mond2 * 2;
	}

	// 如果是无敌属性，且勇士未持有十字架
	if (core.hasSpecial(mon_special, 20) && !core.hasItem("cross"))
		return null; // 不可战斗


	// 战前造成的额外伤害（可被护盾抵消）
	var init_damage = 0;



	// 吸血
	if (core.hasSpecial(mon_special, 11)) {
		var vampire_damage = hero_hp * enemy.value;

		// 如果有神圣盾免疫吸血等可以在这里写
		// 也可以用hasItem和hasEquip来判定装备
		// if (core.hasFlag('shield5')) vampire_damage = 0;

		vampire_damage = Math.floor(vampire_damage) || 0;
		// 加到自身
		if (enemy.add) // 如果加到自身
			mon_hp += vampire_damage;

		init_damage -= vampire_damage;
	}

	// 永生之花
	if (core.hasItem('I767'))
		mon_hp -= core.getFlag('lasthp') * 0.3;

	// 每回合怪物对勇士造成的战斗伤害
	var per_damage = mon_atk - hero_def;
	// 魔攻：战斗伤害就是怪物攻击力
	if (core.hasSpecial(mon_special, 2)) per_damage = mon_atk;

	if (core.hasSpecial(mon_special, 112)) {
		if (hero_atk + hero_def < mon_atk + mon_def) per_damage = mon_atk;
	}




	// 执着
	if (core.hasSpecial(mon_special, 65)) per_damage += hero_hp * 0.001;
	// 惑幻
	var cha = hero_atk - hero_def;

	if (core.getFlag("s120", 0) > 0) {
		cha -= hero_mdef * 0.005;
	}
	if (cha < 0) { cha = 0; }
	if (core.hasSpecial(mon_special, 46)) {
		init_damage += cha * 3;

	}

	if (core.hasSpecial(mon_special, 124)) {
		init_damage += cha * 300;
	}


	// 分裂
	if (core.hasSpecial(mon_special, 32)) {
		per_damage += mon_atk;
	}
	// 天剑
	if (core.hasSpecial(mon_special, 43)) {
		per_damage += mon_atk * 3 - hero_def * 2;
	}

	// 恶魔烧酒
	if (core.hasSpecial(mon_special, 55)) {
		per_damage = mon_atk * 3 + (hero_atk + hero_def) * 0.4;
	}


	// 战斗伤害不能为负值
	if (per_damage < 0) per_damage = 0;

	// 2连击 & 3连击 & N连击
	if (core.hasSpecial(mon_special, 4)) per_damage *= 2;
	if (core.hasSpecial(mon_special, 5)) per_damage *= 3;
	if (core.hasSpecial(mon_special, 6)) per_damage *= (enemy.n || 4);
	if (core.hasSpecial(mon_special, 153)) per_damage *= 50;
	if (core.hasSpecial(mon_special, 154)) per_damage *= 50;
	if (core.hasSpecial(mon_special, 123)) per_damage *= 77;
	if (core.hasSpecial(mon_special, 161)) per_damage *= 0.5;
	// 牵制
	if (core.hasSpecial(mon_special, 33))
		per_damage *= (mon_def / hero_def);

	// 压制
	if (core.hasSpecial(mon_special, 79))
		per_damage *= ((mon_atk + mon_def) / (hero_atk + hero_def));

	// 火1
	if (core.hasSpecial(mon_special, 125))
		per_damage *= ((mon_atk + mon_def) / (hero_atk + hero_def) * (mon_atk + mon_def) / (hero_atk + hero_def));


	// 限制
	if (core.hasSpecial(mon_special, 80))
		per_damage *= (mon_hp / hero_hp);

	// 血灵
	if (core.hasSpecial(mon_special, 11))
		per_damage += (hero_atk + hero_def) * 0.2;

	// 每回合的反击伤害；反击是按照勇士的攻击次数来计算回合
	var counterDamage = 0;
	if (core.hasSpecial(mon_special, 8))
		counterDamage += Math.floor((enemy.atkValue || core.values.counterAttack) * hero_atk);

	// 先攻
	if (core.hasSpecial(mon_special, 1)) init_damage += per_damage;
	// 迅疾
	if (core.hasSpecial(mon_special, 37)) init_damage += per_damage * 3;
	// 飓风
	if (core.hasSpecial(mon_special, 61)) init_damage += per_damage * 20;
	// 追光
	if (core.hasSpecial(mon_special, 69)) init_damage += per_damage * 150;

	// 风1
	if (core.hasSpecial(mon_special, 122)) {
		var f122 = per_damage * 1200 - hero_mdef * 10;
		if (f122 < 0) f122 = 0;
		init_damage += f122;
	}


	// 破甲
	if (core.hasSpecial(mon_special, 7))
		init_damage += Math.floor((enemy.defValue || core.values.breakArmor) * hero_def);

	// 净化
	if (core.hasSpecial(mon_special, 9))
		init_damage += Math.floor((enemy.n || core.values.purify) * hero_mdef);


	// 回风
	if (core.hasSpecial(mon_special, 29)) {
		var per_damage80 = (mon_atk * 0.8) - hero_def;
		var per_damage120 = (mon_atk * 1.2) - hero_def;
		if (per_damage80 <= 0) per_damage80 = 0;
		if (per_damage120 <= 0) per_damage120 = 0;
		per_damage = per_damage80 + per_damage120;
	}



	// 勇士每回合对怪物造成的伤害
	var hero_per_damage = Math.max(hero_atk - mon_def, 0);

	// 自然
	if (core.hasSpecial(mon_special, 141) || (core.getFlag("s141", 0) > 0)) {
		hero_per_damage *= 0.5;
	}


	// 妄无
	if (core.hasItem('I729')) {
		hero_per_damage *= 2;
	}

	// 灵闪
	if (core.hasSpecial(mon_special, 35) && hero_atk / mon_atk <= 1) {
		hero_per_damage *= (1 - (mon_def / hero_def / 2));
		if (hero_def == 0) return null;
	}

	// 反戈
	if (core.hasSpecial(mon_special, 48)) {
		per_damage += hero_per_damage * 0.2;
		hero_per_damage *= 0.8;
	}

	// 恶魔烧酒
	if (core.hasSpecial(mon_special, 55)) {
		hero_per_damage = hero_atk * 0.04 - mon_def;
	}

	// 聆听石
	if (core.hasEquip("I835")) {
		hero_per_damage *= 2;
	}

	if (core.getFlag("magicAtk", 0) > 0) {
		hero_per_damage += core.getFlag("magicAtk", 0);
	}

	// 如果没有破防，则不可战斗
	if (hero_per_damage <= 0) return null;

	// 魔女帽
	if (core.hasEquip('I833')) { hero_per_damage += hero_atk * 0.42; }

	// 雷裁
	if (core.hasItem("I589")) {
		var monchazhi = mon_atk - mon_def
		if (monchazhi > 0)
			hero_per_damage += monchazhi * 0.2;
		else hero_per_damage -= monchazhi * 0.2;
	}
	// 雷裁2
	if (core.hasItem("I746")) {
		var monchazhi = mon_atk - mon_def
		if (monchazhi > 0)
			hero_per_damage += monchazhi * 0.25;
		else hero_per_damage -= monchazhi * 0.25;
	}
	// 雷裁3
	if (core.hasItem("I747")) {
		var monchazhi = mon_atk - mon_def
		if (monchazhi > 0)
			hero_per_damage += monchazhi * 0.3;
		else hero_per_damage -= monchazhi * 0.3;
	}
	// 雷裁4
	if (core.hasItem("I748")) {
		var monchazhi = mon_atk - mon_def
		if (monchazhi > 0)
			hero_per_damage += monchazhi * 0.4;
		else hero_per_damage -= monchazhi * 0.4;
	}

	//水镜

	if (core.getFlag("s120", 0) > 0) {
		per_damage -= hero_mdef * 0.005;
		hero_per_damage -= hero_mdef * 0.005;
		if (hero_per_damage <= 0) {
			if (core.getFlag("magicAtk", 0) > 0) {
				hero_per_damage = core.getFlag("magicAtk", 0);
			} else return null;
		}
		if (per_damage <= 0) per_damage = 0;
	}

	//水盾

	if (core.getFlag("s121", 0) > 0) {
		mon_hp += hero_mdef;
		hero_mdef *= 3;
	}

	// 火2
	if (core.hasSpecial(mon_special, 128)) hero_per_damage *= 2;

	// 勇士的攻击回合数；为怪物生命除以每回合伤害向上取整
	var turn = Math.ceil(mon_hp / hero_per_damage);
	if (turn < 0) { turn = 0; }

	// 唤雨雷暴
	if (core.hasItem('I592')) {
		hero_per_damage *= 1.5;
		if (turn < 101) { hero_per_damage += mon_hp * 0.002; } else mon_hp *= 0.8;
	}
	// 唤雨雷暴
	if (core.hasItem('I847')) {
		hero_per_damage *= 1.5;
		if (turn < 101) { hero_per_damage += mon_hp * 0.0024; } else mon_hp *= 0.76;
	} // 唤雨雷暴
	if (core.hasItem('I848')) {
		hero_per_damage *= 1.5;
		if (turn < 101) { hero_per_damage += mon_hp * 0.0028; } else mon_hp *= 0.72;
	} // 唤雨雷暴
	if (core.hasItem('I849')) {
		hero_per_damage *= 1.5;
		if (turn < 126) { hero_per_damage += mon_hp * 0.0028; } else mon_hp *= 0.65;
	} // 唤雨雷暴
	if (core.hasItem('I850')) {
		hero_per_damage *= 1.5;
		if (turn < 151) { hero_per_damage += mon_hp * 0.0028; } else mon_hp *= 0.58;
	} // 唤雨雷暴
	if (core.hasItem('I851')) {
		hero_per_damage *= 1.5;
		if (turn < 151) { hero_per_damage += mon_hp * 0.0033; } else mon_hp *= 0.505;
	}

	// 暗3
	if (core.hasSpecial(mon_special, 117)) init_damage += Math.floor(turn / 10) * per_damage * 10;

	// 火2
	if (core.hasSpecial(mon_special, 128)) init_damage += Math.floor(turn / 5) * (hero_atk * 0.01 * turn);


	// 冰封
	if (core.hasSpecial(mon_special, 74)) {
		var turnReduce = Math.max(Math.floor(hero_hp / (enemy.atkValue || 0)), 0);
		if (turnReduce > enemy.n) turnReduce = enemy.n;
		turn += (enemy.n - turnReduce);
	}

	// 10回合
	if (core.hasSpecial(mon_special, 71)) {
		if (turn > 10) { turn = 10; }
	}

	// 血雨
	if (core.hasItem("I590")) {
		if (turn < 5) {
			hero_per_damage *= 4;
			Math.floor(per_damage *= 0.25);
		} else {
			init_damage -= per_damage;
			var turn = Math.ceil((mon_hp - hero_per_damage * 12) / hero_per_damage);
			if (turn < 0) turn = 1
		}
	}

	// 血雨2
	if (core.hasItem("I749")) {
		if (turn < 6) {
			hero_per_damage *= 4;
			Math.floor(per_damage *= 0.25);
		} else {
			init_damage -= per_damage;
			var turn = Math.ceil((mon_hp - hero_per_damage * 15) / hero_per_damage);
			if (turn < 0) turn = 1
		}
	}

	// 血雨3
	if (core.hasItem("I750")) {
		if (turn < 7) {
			hero_per_damage *= 4;
			Math.floor(per_damage *= 0.25);
		} else {
			init_damage -= per_damage;
			var turn = Math.ceil((mon_hp - hero_per_damage * 18) / hero_per_damage);
			if (turn < 0) turn = 1
		}
	}

	// 血雨4
	if (core.hasItem("I751")) {
		if (turn < 9) {
			hero_per_damage *= 4;
			Math.floor(per_damage *= 0.25);
		} else {
			init_damage -= per_damage;
			var turn = Math.ceil((mon_hp - hero_per_damage * 24) / hero_per_damage);
			if (turn < 0) turn = 1
		}
	}

	// 斩阵
	if (core.hasSpecial(mon_special, 42)) {
		if (turn > 5)
			init_damage += mon_atk;
		if (turn > 10)
			init_damage += mon_atk * 2;
		if (turn > 15)
			init_damage += mon_atk * 4;

	}


	// 圣阵
	if (core.hasSpecial(mon_special, 64)) {
		if (turn > 50)
			init_damage += (mon_atk + hero_atk + mon_def + hero_def) * 3;
		if (turn > 100)
			init_damage += (mon_atk + hero_atk + mon_def + hero_def) * 9;
		if (turn > 200)
			init_damage += (mon_atk + hero_atk + mon_def + hero_def) * 27;

	}

	// 帝阵
	if (core.hasSpecial(mon_special, 98)) {
		if (turn > 200)
			init_damage += (mon_atk + hero_atk + mon_def + hero_def) * 4;
		if (turn > 400)
			init_damage += (mon_atk + hero_atk + mon_def + hero_def) * 32;
		if (turn > 800)
			init_damage += (mon_atk + hero_atk + mon_def + hero_def) * 128;

	}

	// 回春
	if (core.hasSpecial(mon_special, 51)) {
		mon_hp += turn * mon_hp * 0.03;
		var turn = Math.ceil(mon_hp / hero_per_damage);
	}

	// 回春
	if (core.hasSpecial(mon_special, 129)) {
		mon_hp += turn * turn * mon_hp * 0.0005;
		var turn = Math.ceil(mon_hp / hero_per_damage);
	}

	// 
	if (core.hasSpecial(mon_special, 44)) {
		per_damage *= (turn + 1);
	}

	// 绝世
	var wind = mon_atk * 0.9 - hero_def;
	if (wind < 0) { wind = 0; }
	if (core.hasSpecial(mon_special, 45)) {
		init_damage += wind * 5;
	}

	// 极冲
	var wind = mon_atk * 0.9 - hero_def;
	if (wind < 0) { wind = 0; }
	if (core.hasSpecial(mon_special, 101)) {
		init_damage += wind * 233;
	}

	// ------ 支援 ----- //
	// 这个递归最好想明白为什么，flag:__extraTurn__是怎么用的
	var guards = core.getFlag("__guards__" + x + "_" + y, enemyInfo.guards);
	var guard_before_current_enemy = false; // ------ 支援怪是先打(true)还是后打(false)？
	turn += core.getFlag("__extraTurn__", 0);
	if (guards.length > 0) {
		if (!guard_before_current_enemy) { // --- 先打当前怪物，记录当前回合数
			core.setFlag("__extraTurn__", turn);
		}
		// 获得那些怪物组成小队战斗
		for (var i = 0; i < guards.length; i++) {
			var gx = guards[i][0],
				gy = guards[i][1],
				gid = guards[i][2];
			// 递归计算支援怪伤害信息，这里不传x,y保证不会重复调用
			// 这里的mdef传0，因为护盾应该只会被计算一次
			var info = core.enemys.getDamageInfo(core.material.enemys[gid], { hp: origin_hero_hp, atk: origin_hero_atk, def: origin_hero_def, mdef: 0 });
			if (info == null) { // 小队中任何一个怪物不可战斗，直接返回null
				core.removeFlag("__extraTurn__");
				return null;
			}
			// 已经进行的回合数
			core.setFlag("__extraTurn__", info.turn);
			init_damage += info.damage;
		}
		if (guard_before_current_enemy) { // --- 先打支援怪物，增加当前回合数
			turn += core.getFlag("__extraTurn__", 0);
		}
	}
	core.removeFlag("__extraTurn__");
	// ------ 支援END ------ //

	// 冰符咒
	if (core.hasSpecial(mon_special, 52)) {
		mon_hp -= 99 * hero_per_damage;
		if (turn >= 100) init_damage += mon_atk * 20;
	}



	// 异界
	if (core.hasSpecial(mon_special, 36)) turn *= turn;

	// 回合控制
	if (turn >= 999999) turn = 999999;


	// 自爆
	if (core.hasSpecial(mon_special, 62)) {
		if (turn >= 200) {
			turn = 200;
			var zibaodanage = mon_hp - turn * hero_per_damage;
			if (zibaodanage < 0) zibaodanage = 0;
			init_damage += zibaodanage * 4;
		}
	}

	// 自爆
	if (core.hasSpecial(mon_special, 162)) {
		if (turn >= 20) {
			turn = 20;
			var zibaodanage = mon_hp - turn * hero_per_damage;
			if (zibaodanage < 0) zibaodanage = 0;
			init_damage += zibaodanage * 4;
		}
	}

	// 冰剑
	if (core.hasSpecial(mon_special, 75)) {
		var damageReduce75 = Math.floor((hero_mdef) / (enemy.atkValue || 0)) * 0.0005;
		if (damageReduce75 > 1) damageReduce75 = 1;
		init_damage += (hero_atk + hero_def) * 100 * (1 - damageReduce75);
	}


	// 冻伤
	if (core.hasSpecial(mon_special, 76)) {
		var damageReduce76 = Math.floor((hero_atk + hero_def) / (enemy.atkValue || 0)) * 0.0005;
		if (damageReduce76 > 1) damageReduce76 = 1;
		init_damage += hero_mdef * 100 * (1 - damageReduce76);
	}


	// 最终伤害：初始伤害 + 怪物对勇士造成的伤害 + 反击伤害
	var damage = init_damage + (turn - 1) * per_damage + turn * counterDamage;

	// 血杀
	if (core.hasSpecial(mon_special, 95)) {
		if (hero_hp >= mon_hp) damage *= 1.5;
		else damage *= 0.5;
	}

	// 风2
	if (core.hasSpecial(mon_special, 123)) {
		if (turn <= 999)
			damage *= 1 / (1000 - turn);
	}

	// 琉璃灵果
	if (core.hasItem("I591")) {
		hero_mdef *= 3;
	}
	// 琉璃灵果
	if (core.hasItem("I842")) {
		hero_mdef *= 3.6;
	} // 琉璃灵果
	if (core.hasItem("I843")) {
		hero_mdef *= 4.2;
	} // 琉璃灵果
	if (core.hasItem("I844")) {
		hero_mdef *= 4.95;
	} // 琉璃灵果
	if (core.hasItem("I845")) {
		hero_mdef *= 5.7;
	} // 琉璃灵果
	if (core.hasItem("I846")) {
		hero_mdef *= 6.45;
	}

	if (core.hasSpecial(mon_special, 119)) {
		hero_mdef *= 10;
	}

	// 再扣去护盾
	damage -= hero_mdef;

	// 溯回间
	if (core.getFlag("s143", 0) > 0) {
		if (core.hasSpecial(mon_special, 143))
			damage *= 0.25;
		else damage *= 1.5;
	}

	//秘果
	if (core.hasItem('I602')) {
		damage -= (mon_atk + mon_def) * 1.6;
	}
	//秘果2
	if (core.hasItem('I755')) {
		damage -= (mon_atk + mon_def) * 2;
	}
	//秘果3
	if (core.hasItem('I756')) {
		damage -= (mon_atk + mon_def) * 2.4;
	}
	//秘果4
	if (core.hasItem('I757')) {
		damage -= (mon_atk + mon_def) * 3.2;
	}

	// 匙弱
	if (core.hasSpecial(mon_special, 59)) {
		damage *= 1 - (core.itemCount("yellowKey") * 0.03);
		if (core.itemCount("yellowKey") > 33) damage = 0
	}
	// 匙弱
	if (core.hasSpecial(mon_special, 72)) {
		damage *= 1 - (core.itemCount("yellowKey") * 0.02);
		if (core.itemCount("yellowKey") > 50) damage = 0
	}
	// 匙弱
	if (core.hasSpecial(mon_special, 68)) {
		damage *= 1 - (core.itemCount("blueKey") * 0.03);
		if (core.itemCount("blueKey") > 33) damage = 0
	}
	// 匙弱
	if (core.hasSpecial(mon_special, 73)) {
		damage *= 1 - (core.itemCount("blueKey") * 0.02);
		if (core.itemCount("blueKey") > 50) damage = 0
	}
	// 匙强
	if (core.hasSpecial(mon_special, 82)) {
		damage *= 1 + (core.itemCount("yellowKey") * 0.001);
	}
	if (core.hasSpecial(mon_special, 83)) {
		damage *= 1 + (core.itemCount("blueKey") * 0.001);
	}
	// 水弱
	if (core.hasSpecial(mon_special, 149)) {
		damage *= 1 - (core.itemCount("I1179") * 0.01);
	}
	// 检查是否允许负伤
	if (!core.flags.enableNegativeDamage)
		damage = Math.max(0, damage);

	// 撕裂
	if (core.hasSpecial(mon_special, 41)) damage = Math.floor(1.5 * damage);

	// 大撕裂
	if (core.hasSpecial(mon_special, 118)) damage = Math.floor(4 * damage);

	// 最后处理仇恨和固伤（因为这两个不能被护盾减伤）
	if (core.hasSpecial(mon_special, 17)) { // 仇恨
		damage += core.getFlag('hatred', 0);
	}
	if (core.hasSpecial(mon_special, 22)) { // 灵体
		if (hero_mdef * 10 < enemy.damage || 0) {
			damage += enemy.damage || 0;
			damage -= hero_mdef * 9;
		} else damage = damage;
	}

	if (core.hasSpecial(mon_special, 160)) { // 大灵体
		if (hero_mdef * 100 < enemy.damage || 0) {
			damage += enemy.damage || 0;
			damage -= hero_mdef * 99;
		} else damage = damage;
	}

	if (core.hasSpecial(mon_special, 56)) { // 刺客
		damage += 400000;
	}

	if (core.hasSpecial(mon_special, 144)) { //
		damage *= (1 + 0.5 * core.getFlag("sq144", 0));
	}

	// 魈（一阶段）
	if (core.hasSpecial(mon_special, 107) && core.getFlag("500f", 0) < 4) {
		damage *= 1.5;
	}

	// 魈（二阶段）
	if (core.hasSpecial(mon_special, 108) && core.getFlag("500f", 0) < 8) {
		damage *= 1.5;
	}

	// 魈（三阶段）
	if (core.hasSpecial(mon_special, 109) && core.getFlag("500f", 0) < 14) {
		damage *= 1.5;
	}

	// 魈（四阶段）
	if (core.hasSpecial(mon_special, 110) && core.getFlag("500f", 0) < 20) {
		damage *= 1.5;
	}

	// 水
	if (core.hasSpecial(mon_special, 134) && core.getFlag("650f1", 0) > 0) {
		damage *= (1 - core.getFlag('650f1', 0) * 0.05);
	}
	// 光
	if (core.hasSpecial(mon_special, 135) && core.getFlag("650f2", 0) > 0) {
		damage *= (1 - core.getFlag('650f2', 0) * 0.05);
	}
	// 火
	if (core.hasSpecial(mon_special, 136) && core.getFlag("650f3", 0) > 0) {
		damage *= (1 - core.getFlag('650f3', 0) * 0.05);
	}
	// 木
	if (core.hasSpecial(mon_special, 137) && core.getFlag("650f4", 0) > 0) {
		damage *= (1 - core.getFlag('650f4', 0) * 0.05);
	}
	// 暗
	if (core.hasSpecial(mon_special, 138) && core.getFlag("650f5", 0) > 0) {
		damage *= (1 - core.getFlag('650f5', 0) * 0.05);
	}


	// E
	if (core.hasItem('I581')) {
		damage *= 0.64;
	}

	// H
	if (core.hasItem('I582')) {
		damage *= 0.92;
	}



	// 琉璃2
	if (core.hasItem('I752')) {
		damage *= 0.875;
	} // 琉璃3
	if (core.hasItem('I753')) {
		damage *= 0.85;
	} // 琉璃4
	if (core.hasItem('I754')) {
		damage *= 0.8;
	}

	// 限制
	if (core.hasSpecial(mon_special, 96))
		damage *= (mon_hp / hero_hp);


	// 压制
	if (core.hasSpecial(mon_special, 148))
		damage *= ((mon_atk + mon_def) / (hero_atk + hero_def));

	// 清灵
	var qing = mon_hp / (hero_atk - mon_def);
	if (qing > 1000) {
		qing = 1000;
	}
	if (core.hasItem("I588")) {
		damage -= Math.ceil(hero_per_damage * 0.08) * qing;
	}
	// 清灵2
	if (core.hasItem("I743")) {
		damage -= Math.ceil(hero_per_damage * 0.1) * qing;
	}
	// 清灵3
	if (core.hasItem("I744")) {
		damage -= Math.ceil(hero_per_damage * 0.12) * qing;
	}
	// 清灵4
	if (core.hasItem("I745")) {
		damage -= Math.ceil(hero_per_damage * 0.16) * qing;
	}
	// 琉璃灵果
	if (core.hasItem("I591")) {
		damage -= (mon_atk + mon_def) * 8;
	}
	// 琉璃灵果6
	if (core.hasItem("I846")) {
		damage -= (mon_atk + mon_def) * 16.8;
	} // 琉璃灵果2
	if (core.hasItem("I842")) {
		damage -= (mon_atk + mon_def) * 9.6;
	} // 琉璃灵果3
	if (core.hasItem("I843")) {
		damage -= (mon_atk + mon_def) * 10.8;
	} // 琉璃灵果4
	if (core.hasItem("I844")) {
		damage -= (mon_atk + mon_def) * 12.8;
	} // 琉璃灵果5
	if (core.hasItem("I845")) {
		damage -= (mon_atk + mon_def) * 14.8;
	}

	if (core.hasSpecial(mon_special, 54)) { // 禁制
		if (damage < 0) damage = 0
	}



	return {
		"mon_hp": Math.floor(mon_hp),
		"mon_atk": Math.floor(mon_atk),
		"mon_def": Math.floor(mon_def),
		"init_damage": Math.floor(init_damage),
		"per_damage": Math.floor(per_damage),
		"hero_per_damage": Math.floor(hero_per_damage),
		"turn": Math.floor(turn),
		"damage": Math.floor(damage)
	};
}
    },
    "actions": {
        "onKeyUp": function (keyCode, altKey) {
	// 键盘按键处理，可以在这里自定义快捷键列表
	// keyCode：当前按键的keyCode（每个键的keyCode自行百度）
	// altKey：Alt键是否被按下，为true代表同时按下了Alt键
	// 可以在这里任意增加或编辑每个按键的行为

	// 如果处于正在行走状态，则不处理
	if (core.isMoving())
		return;

	// Alt+0~9，快捷换上套装
	if (altKey && keyCode >= 48 && keyCode <= 57) {
		core.items.quickLoadEquip(keyCode - 48);
		return;
	}

	// 根据keyCode值来执行对应操作
	switch (keyCode) {
	case 27: // ESC：打开菜单栏
		core.openSettings(true);
		break;
	case 88: // X：使用怪物手册
		core.openBook(true);
		break;
	case 71: // G：使用楼传器
		core.useFly(true);
		break;
	case 65: // A：读取自动存档（回退）
		core.doSL("autoSave", "load");
		break;
	case 87: // W：撤销回退
		core.doSL("autoSave", "reload");
		break;
	case 83: // S：存档
		core.save(true);
		break;
	case 68: // D：读档
		core.load(true);
		break;
	case 69: // E：打开光标
		core.ui._drawCursor();
		break;
	case 84: // T：打开道具栏
		core.openToolbox(true);
		break;
	case 81: // Q：打开装备栏
		core.openEquipbox(true);
		break;
	case 90: // Z：转向
		core.turnHero();
		break;
	case 86: // V：打开快捷商店列表
		core.openQuickShop(true);
		break;
	case 32: // SPACE：轻按
		core.getNextItem();
		break;
	case 82: // R：回放录像
		core.ui._drawReplay();
		break;
	case 33:
	case 34: // PgUp/PgDn：浏览地图
		core.ui._drawViewMaps();
		break;
	case 66: // B：打开数据统计
		core.ui._drawStatistics();
		break;
	case 72: // H：打开帮助页面
		core.ui._drawHelp();
		break;
	case 77: // M：打开存档笔记
		core.actions._clickNotes_show();
		break;
	case 78: // N：重新开始
		core.confirmRestart();
		break;
	case 79: // O：查看工程
		core.actions._clickGameInfo_openProject();
		break;
	case 80: // P：游戏主页
		core.actions._clickGameInfo_openComments();
		break;
	case 49: // 快捷键1: 破
		if (core.hasItem('pickaxe')) {
			core.status.route.push("key:49"); // 将按键记在录像中
			core.useItem('pickaxe', true); // 第二个参数true代表该次使用道具是被按键触发的，使用过程不计入录像
		}
		break;
	case 50: // 快捷键2: 炸
		if (core.hasItem('bomb')) {
			core.status.route.push("key:50"); // 将按键记在录像中
			core.useItem('bomb', true); // 第二个参数true代表该次使用道具是被按键触发的，使用过程不计入录像
		}
		break;
	case 51: // 快捷键3: 飞
		if (core.hasItem('centerFly')) {
			core.ui._drawCenterFly();
		}
		break;
	case 52: // 快捷键4：破冰/冰冻/地震/上下楼器/... 其他道具依次判断
		{
			var list = ["icePickaxe", "freezeBadge", "earthquake", "upFly", "downFly", "jumpShoes", "lifeWand", "poisonWine", "weakWine", "curseWine", "superWine"];
			for (var i = 0; i < list.length; i++) {
				var itemId = list[i];
				if (core.canUseItem(itemId)) {
					core.status.route.push("key:52");
					core.useItem(itemId, true);
					break;
				}
			}
		}
		break;
	case 53: // 5：读取自动存档（回退），方便手机版操作
		core.doSL("autoSave", "load");
		break;
	case 54: // 6：撤销回退，方便手机版操作
		core.doSL("autoSave", "reload");
		break;
	case 55: // 快捷键7：绑定为轻按，方便手机版操作
		core.getNextItem();
		break;
	case 118: // F7：开启debug模式
		core.debug();
		break;
	case 70: // F：开启技能“二倍斩”
		// 检测是否拥有“二倍斩”这个技能道具
		if (core.hasItem('I945')) {
			core.status.route.push("key:70");
			core.useItem('I945', true);
		}
		break;
		// 在这里可以任意新增或编辑已有的快捷键内容
		/*
		case 0: // 使用该按键的keyCode
			// 还可以再判定altKey是否被按下，即 if (altKey) { ...

			// ... 在这里写你要执行脚本
			// **强烈建议所有新增的自定义快捷键均能给个对应的道具可点击，以方便手机端的行为**
			if (core.hasItem('...')) {
				core.status.route.push("key:0");
				core.useItem('...', true); // 增加true代表该使用道具不计入录像
			}

			break;
		*/
	}

},
        "onStatusBarClick": function (px, py, vertical) {
	// 点击状态栏时触发的事件，仅在自绘状态栏开启时生效
	// px和py为点击的像素坐标
	// vertical为录像播放过程中的横竖屏信息
	// 
	// 横屏模式下状态栏的画布大小是 129*416 （开启拓展装备栏后是 129*457）
	// 竖屏模式下状态栏的画布大小是 416*(32*rows+9) 其中rows为状态栏行数，即全塔属性中statusCanvasRowsOnMobile值
	// 可以使用 _isVertical() 来判定当前是否是竖屏模式

	// 判定当前是否是竖屏模式。录像播放过程中可能会记录当时的横竖屏信息以覆盖。
	var _isVertical = function () {
		if (core.isReplaying() && vertical != null) return vertical;
		return core.domStyle.isVertical;
	}

	// 如果正在执行事件，则忽略
	if (core.status.lockControl) return;
	// 如果当前正在行走，则忽略；也可以使用 core.waitHeroToStop(callback) 来停止行走再回调执行脚本
	if (core.isMoving()) return;

	// 判定px和py来执行自己的脚本内容.... 注意横竖屏
	// console.log("onStatusBarClick: ", px, py, _isVertical());

	// 样例一：点击某个区域后使用一个道具
	/*
	if (core.hasItem("pickaxe")) {
		if (_isVertical()) {
			// 竖屏模式下
			if (px >= 200 && px <= 250 && py >= 50 && py <= 100) {
				core.useItem("pickaxe");
			}
		} else {
			// 横屏模式下
			if (px >= 50 && px <= 100 && py >= 200 && py <= 250) {
				core.useItem("pickaxe");
			}
		}
	}
	*/

	// 样例二：点击某个区域后执行一段公共事件或脚本
	/*
	if (core.hasFlag("xxx")) {
		if (_isVertical()) {
			// 竖屏模式下
			if (px >= 200 && px <= 250 && py >= 50 && py <= 100) {
				// 记录点击坐标。这里的1代表此时是竖屏！
				core.status.route.push("click:1:" + px + ":" + py);

				// 可以插入公共事件 / 普通事件 / 执行一段脚本（如打开自绘UI或增减flag）
				core.insertCommonEvent("道具商店");
				// core.insertAction(["一段事件"]);
				// core.openItemShop("shop1");
			}
		} else {
			// 横屏模式下
			if (px >= 50 && px <= 100 && py >= 200 && py <= 250) {
				// 记录点击坐标。这里的0代表此时是横屏！
				core.status.route.push("click:0:" + px + ":" + py);

				// 可以插入公共事件 / 普通事件 / 执行一段脚本（如打开自绘UI或增减flag）
				core.insertCommonEvent("道具商店");
				// core.insertAction(["一段事件"]);
				// core.openItemShop("shop1");
			}
		}
	}
	*/

}
    },
    "control": {
        "saveData": function () {
	// 存档操作，此函数应该返回“具体要存档的内容”

	// 差异化存储values
	var values = {};
	for (var key in core.values) {
		if (!core.same(core.values[key], core.data.values[key]))
			values[key] = core.clone(core.values[key]);
	}

	// 要存档的内容
	var data = {
		'floorId': core.status.floorId,
		'hero': core.clone(core.status.hero),
		'hard': core.status.hard,
		'maps': core.maps.saveMap(),
		'route': core.encodeRoute(core.status.route),
		'values': values,
		'version': core.firstData.version,
		'guid': core.getGuid(),
		"time": new Date().getTime()
	};

	return data;
},
        "loadData": function (data, callback) {
	// 读档操作；从存储中读取了内容后的行为

	// 重置游戏和路线
	core.resetGame(data.hero, data.hard, data.floorId, core.maps.loadMap(data.maps, null, data.hero.flags), data.values);
	core.status.route = core.decodeRoute(data.route);
	core.control._bindRoutePush();
	// 文字属性，全局属性
	core.status.textAttribute = core.getFlag('textAttribute', core.status.textAttribute);
	var toAttribute = core.getFlag('globalAttribute', core.status.globalAttribute);
	if (!core.same(toAttribute, core.status.globalAttribute)) {
		core.status.globalAttribute = toAttribute;
		core.resize();
	}
	// 重置音量
	core.events.setVolume(core.getFlag("__volume__", 1), 0);
	// 加载勇士图标
	var icon = core.status.hero.image;
	icon = core.getMappedName(icon);
	if (core.material.images.images[icon]) {
		core.material.images.hero = core.material.images.images[icon];
		core.material.icons.hero.width = core.material.images.images[icon].width / 4;
		core.material.icons.hero.height = core.material.images.images[icon].height / 4;
	}
	core.setFlag('__fromLoad__', true);

	// TODO：增加自己的一些读档处理

	// 切换到对应的楼层
	core.changeFloor(data.floorId, null, data.hero.loc, 0, function () {
		// TODO：可以在这里设置读档后播放BGM
		if (core.hasFlag("__bgm__")) { // 持续播放
			core.playBgm(core.getFlag("__bgm__"));
		}

		core.removeFlag('__fromLoad__');
		if (callback) callback();
	});
},
        "getStatusLabel": function (name) {
	// 返回某个状态英文名的对应中文标签，如atk -> 攻击，def -> 防御等。
	// 请注意此项仅影响 libs/ 下的内容（如绘制怪物手册、数据统计等）
	// 自行定义的（比如获得道具效果）中用到的“攻击+3”等需要自己去对应地方修改

	return {
		name: "名称",
		lv: "等级",
		hpmax: "生命上限",
		hp: "生命",
		manamax: "魔力上限",
		mana: "魔力",
		atk: "攻击",
		def: "防御",
		mdef: "护盾",
		money: "领悟",
		exp: "经验",
		point: "加点",
		steps: "步数",
	} [name] || name;
},
        "triggerDebuff": function (action, type) {
	// 毒衰咒效果的获得与解除
	// action：获得还是解除；'get'表示获得，'remove'表示解除
	// type：一个数组表示获得了哪些毒衰咒效果；poison, weak，curse
	if (!(type instanceof Array)) type = [type];

	if (action == 'get') {
		if (core.inArray(type, 'poison') && !core.hasFlag("poison")) {
			// 获得毒效果
			core.setFlag('poison', true);
		}
		if (core.inArray(type, 'weak') && !core.hasFlag('weak')) {
			// 获得衰效果
			core.setFlag('weak', true);
			if (core.values.weakValue >= 1) {
				// >=1，直接扣数值
				core.addStatus('atk', -core.values.weakValue);
				core.addStatus('def', -core.values.weakValue);
			} else {
				// <1，扣比例
				core.addBuff('atk', -core.values.weakValue);
				core.addBuff('def', -core.values.weakValue);
			}
		}
		if (core.inArray(type, 'curse') && !core.hasFlag('curse')) {
			// 获得咒效果
			core.setFlag('curse', true);
		}
	} else if (action == 'remove') {
		var success = false;
		if (core.inArray(type, "poison") && core.hasFlag("poison")) {
			success = true;
			// 移除毒效果
			core.setFlag("poison", false);
		}
		if (core.inArray(type, "weak") && core.hasFlag("weak")) {
			success = true;
			// 移除衰效果
			core.setFlag("weak", false);
			if (core.values.weakValue >= 1) {
				// >=1，直接扣数值
				core.addStatus('atk', core.values.weakValue);
				core.addStatus('def', core.values.weakValue);
			} else {
				// <1，扣比例
				core.addBuff('atk', core.values.weakValue);
				core.addBuff('def', core.values.weakValue);
			}
		}
		if (core.inArray(type, "curse") && core.hasFlag("curse")) {
			success = true;
			// 移除咒效果
			core.setFlag("curse", false);
		}
		if (success) core.playSound('回血');
	}
},
        "updateStatusBar": function () {
	// 更新状态栏

	// 检查等级
	core.events.checkLvUp();

	// 检查HP上限
	if (core.flags.statusBarItems.indexOf('enableHPMax') >= 0) {
		core.setStatus('hp', Math.min(core.getRealStatus('hpmax'), core.getStatus('hp')));
	}

	// 设置楼层名
	if (core.status.floorId) {
		core.setStatusBarInnerHTML('floor', core.status.maps[core.status.floorId].name);
	}

	// 设置勇士名字和图标
	core.setStatusBarInnerHTML('name', core.getStatus('name'));
	// 设置等级名称
	core.setStatusBarInnerHTML('lv', core.getLvName());

	// 设置生命上限、生命值、攻防护盾金币和经验值
	var statusList = ['hpmax', 'hp', 'mana', 'atk', 'def', 'mdef', 'money', 'exp'];
	statusList.forEach(function (item) {
		// 向下取整
		core.status.hero[item] = Math.floor(core.status.hero[item]);
		// 大数据格式化
		core.setStatusBarInnerHTML(item, core.getRealStatus(item));
	});

	// 设置魔力值; status:manamax 只有在非负时才生效。
	if (core.status.hero.manamax != null && core.getRealStatus('manamax') >= 0) {
		core.status.hero.mana = Math.min(core.status.hero.mana, core.getRealStatus('manamax'));
		core.setStatusBarInnerHTML('mana', core.status.hero.mana + "/" + core.getRealStatus('manamax'));
	} else {
		core.setStatusBarInnerHTML("mana", core.status.hero.mana);
	}
	// 设置技能栏
	// 可以用flag:skill表示当前开启的技能类型，flag:skillName显示技能名；详见文档-个性化-技能塔的支持
	core.setStatusBarInnerHTML('skill', core.getFlag('skillName', '无'));

	// 可以在这里添加自己额外的状态栏信息，比如想攻击显示 +0.5 可以这么写：
	// if (core.hasFlag('halfAtk')) core.setStatusBarInnerHTML('atk', core.statusBar.atk.innerText + "+0.5");

	// 如果是自定义添加的状态栏，也需要在这里进行设置显示的数值

	// 进阶
	if (core.flags.statusBarItems.indexOf('enableLevelUp') >= 0) {
		core.setStatusBarInnerHTML('up', core.formatBigNumber(core.getNextLvUpNeed()) || "");
	} else core.setStatusBarInnerHTML('up', "");

	// 钥匙
	var keys = ['yellowKey', 'blueKey', 'redKey', 'greenKey'];
	keys.forEach(function (key) {
		core.setStatusBarInnerHTML(key, core.setTwoDigits(core.itemCount(key)));
	});
	// 毒衰咒
	core.setStatusBarInnerHTML('poison', core.hasFlag('poison') ? "毒" : "");
	core.setStatusBarInnerHTML('weak', core.hasFlag('weak') ? "衰" : "");
	core.setStatusBarInnerHTML('curse', core.hasFlag('curse') ? "咒" : "");
	// 破炸飞
	core.setStatusBarInnerHTML('pickaxe', "破" + core.itemCount('pickaxe'));
	core.setStatusBarInnerHTML('bomb', "炸" + core.itemCount('bomb'));
	core.setStatusBarInnerHTML('fly', "飞" + core.itemCount('centerFly'));

	// 难度
	if (core.statusBar.hard.innerText != core.status.hard) {
		core.statusBar.hard.innerText = core.status.hard;
	}
	var hardColor = core.getFlag('__hardColor__', 'red');
	if (core.statusBar.hard.getAttribute('_style') != hardColor) {
		core.statusBar.hard.style.color = hardColor;
		core.statusBar.hard.setAttribute('_style', hardColor);
	}
	// 自定义状态栏绘制
	core.drawStatusBar();

	// 更新阻激夹域的伤害值
	core.updateCheckBlock();
	// 更新全地图显伤
	core.updateDamage();
},
        "updateCheckBlock": function (floorId) {
	// 领域、夹击、阻击等的伤害值计算
	floorId = floorId || core.status.floorId;
	if (!floorId || !core.status.maps) return;

	var width = core.floors[floorId].width,
		height = core.floors[floorId].height;
	var blocks = core.getMapBlocksObj(floorId);

	var damage = {}, // 每个点的伤害值
		type = {}, // 每个点的伤害类型
		repulse = {}, // 每个点的阻击怪信息
		ambush = {}; // 每个点的捕捉信息
	var betweenAttackLocs = {}; // 所有可能的夹击点
	var needCache = false;
	var canGoDeadZone = core.flags.canGoDeadZone;
	core.flags.canGoDeadZone = true;

	// 计算血网和领域、阻击、激光的伤害，计算捕捉信息
	for (var loc in blocks) {
		var block = blocks[loc],
			x = block.x,
			y = block.y,
			id = block.event.id,
			enemy = core.material.enemys[id];
		if (block.disable) continue;

		type[loc] = type[loc] || {};

		// 血网
		// 如需调用当前楼层的ratio可使用  core.status.maps[floorId].ratio
		if (id == 'lavaNet' && !core.hasItem('amulet')) {
			damage[loc] = (damage[loc] || 0) + core.values.lavaDamage;
			type[loc][(block.event.name || "血网") + "伤害"] = true;
		}

		// 领域
		// 如果要防止领域伤害，可以直接简单的将 flag:no_zone 设为true
		if (enemy && core.hasSpecial(enemy.special, 15) && !core.hasFlag('no_zone')) {
			// 领域范围，默认为1
			var range = enemy.range || 1;
			// 是否是九宫格领域
			var zoneSquare = false;
			if (enemy.zoneSquare != null) zoneSquare = enemy.zoneSquare;
			// 在范围内进行搜索，增加领域伤害值
			for (var dx = -range; dx <= range; dx++) {
				for (var dy = -range; dy <= range; dy++) {
					if (dx == 0 && dy == 0) continue;
					var nx = x + dx,
						ny = y + dy,
						currloc = nx + "," + ny;
					if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
					// 如果是十字领域，则还需要满足 |dx|+|dy|<=range
					if (!zoneSquare && Math.abs(dx) + Math.abs(dy) > range) continue;
					damage[currloc] = (damage[currloc] || 0) + (enemy.value || 0);
					type[currloc] = type[currloc] || {};
					type[currloc]["领域伤害"] = true;
				}
			}
		}

		// 阻击
		// 如果要防止阻击伤害，可以直接简单的将 flag:no_repulse 设为true
		if (enemy && core.hasSpecial(enemy.special, 18) && !core.hasFlag('no_repulse')) {
			var scan = enemy.zoneSquare ? core.utils.scan2 : core.utils.scan;
			for (var dir in scan) {
				var nx = x + scan[dir].x,
					ny = y + scan[dir].y,
					currloc = nx + "," + ny;
				if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
				damage[currloc] = (damage[currloc] || 0) + (enemy.zuji || 0);
				type[currloc] = type[currloc] || {};
				type[currloc]["阻击伤害"] = true;

				var rdir = core.turnDirection(":back", dir);
				// 检查下一个点是否存在事件（从而判定是否移动）
				var rnx = x + scan[rdir].x,
					rny = y + scan[rdir].y;
				if (rnx < 0 || rnx >= width || rny < 0 || rny >= height) continue;
				// 如需禁止阻击被推到已隐藏的事件处（如重生怪处），可将这一句的false改为true
				if (core.getBlock(rnx, rny, floorId, false) != null) continue;
				if (core.utils.scan[rdir] && !core.canMoveHero(x, y, rdir, floorId)) continue;
				repulse[currloc] = (repulse[currloc] || []).concat([
					[x, y, id, rdir]
				]);
			}
		}

		// 激光
		// 如果要防止激光伤害，可以直接简单的将 flag:no_laser 设为true
		if (enemy && core.hasSpecial(enemy.special, 24) && !core.hasFlag("no_laser")) {
			for (var nx = 0; nx < width; nx++) {
				var currloc = nx + "," + y;
				if (nx != x) {
					damage[currloc] = (damage[currloc] || 0) + (enemy.value || 0);
					type[currloc] = type[currloc] || {};
					type[currloc]["激光伤害"] = true;
				}
			}
			for (var ny = 0; ny < height; ny++) {
				var currloc = x + "," + ny;
				if (ny != y) {
					damage[currloc] = (damage[currloc] || 0) + (enemy.value || 0);
					type[currloc] = type[currloc] || {};
					type[currloc]["激光伤害"] = true;
				}
			}
		}

		// 捕捉
		// 如果要防止捕捉效果，可以直接简单的将 flag:no_ambush 设为true
		if (enemy && core.enemys.hasSpecial(enemy.special, 27) && !core.hasFlag("no_ambush")) {
			var scan = enemy.zoneSquare ? core.utils.scan2 : core.utils.scan;
			// 给周围格子加上【捕捉】记号
			for (var dir in scan) {
				var nx = x + scan[dir].x,
					ny = y + scan[dir].y,
					currloc = nx + "," + ny;
				if (nx < 0 || nx >= width || ny < 0 || ny >= height || (core.utils.scan[dir] && !core.canMoveHero(x, y, dir, floorId))) continue;
				ambush[currloc] = (ambush[currloc] || []).concat([
					[x, y, id, dir]
				]);
			}
		}

		// 夹击；在这里提前计算所有可能的夹击点，具体计算逻辑在下面
		// 如果要防止夹击伤害，可以简单的将 flag:no_betweenAttack 设为true
		if (enemy && core.enemys.hasSpecial(enemy.special, 16) && !core.hasFlag('no_betweenAttack')) {
			for (var dir in core.utils.scan) {
				var nx = x + core.utils.scan[dir].x,
					ny = y + core.utils.scan[dir].y,
					currloc = nx + "," + ny;
				if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
				betweenAttackLocs[currloc] = true;
			}
		}

		// 检查地图范围类技能
		var specialFlag = core.getSpecialFlag(enemy);
		if (specialFlag & 1) needCache = true;
		if (core.status.event.id == 'viewMaps') needCache = true;
		if ((core.status.event.id == 'book' || core.status.event.id == 'bool-detail') && core.status.event.ui) needCache = true;
	}

	// 对每个可能的夹击点计算夹击伤害
	for (var loc in betweenAttackLocs) {
		var xy = loc.split(","),
			x = parseInt(xy[0]),
			y = parseInt(xy[1]);
		// 夹击怪物的ID
		var enemyId1 = null,
			enemyId2 = null;
		// 检查左右夹击
		var leftBlock = blocks[(x - 1) + "," + y],
			rightBlock = blocks[(x + 1) + "," + y];
		var leftId = core.getFaceDownId(leftBlock),
			rightId = core.getFaceDownId(rightBlock);
		if (leftBlock && !leftBlock.disable && rightBlock && !rightBlock.disable && leftId == rightId) {
			if (core.hasSpecial(leftId, 16))
				enemyId1 = leftId;
		}
		// 检查上下夹击
		var topBlock = blocks[x + "," + (y - 1)],
			bottomBlock = blocks[x + "," + (y + 1)];
		var topId = core.getFaceDownId(topBlock),
			bottomId = core.getFaceDownId(bottomBlock);
		if (topBlock && !topBlock.disable && bottomBlock && !bottomBlock.disable && topId == bottomId) {
			if (core.hasSpecial(topId, 16))
				enemyId2 = topId;
		}

		if (enemyId1 != null || enemyId2 != null) {
			var leftHp = core.status.hero.hp - (damage[loc] || 0);
			if (leftHp > 1) {
				// 夹击伤害值
				var value = Math.floor(leftHp / 2);
				// 是否不超过怪物伤害值
				if (core.flags.betweenAttackMax) {
					var enemyDamage1 = core.getDamage(enemyId1, x, y, floorId);
					if (enemyDamage1 != null && enemyDamage1 < value)
						value = enemyDamage1;
					var enemyDamage2 = core.getDamage(enemyId2, x, y, floorId);
					if (enemyDamage2 != null && enemyDamage2 < value)
						value = enemyDamage2;
				}
				if (value > 0) {
					damage[loc] = (damage[loc] || 0) + value;
					type[loc] = type[loc] || {};
					type[loc]["夹击伤害"] = true;
				}
			}
		}
	}

	// 取消注释下面这一段可以让护盾抵御阻激夹域伤害
	/*
	for (var loc in damage) {
		damage[loc] = Math.max(0, damage[loc] - core.getRealStatus('mdef'));
	}
	*/

	core.flags.canGoDeadZone = canGoDeadZone;
	core.status.checkBlock = {
		damage: damage,
		type: type,
		repulse: repulse,
		ambush: ambush,
		needCache: needCache,
		cache: {} // clear cache
	};
},
        "moveOneStep": function (callback) {
	// 勇士每走一步后执行的操作。callback为行走完毕后的回调
	// 这个函数执行在“刚走完”的时候，即还没有检查该点的事件和领域伤害等。
	// 请注意：瞬间移动不会执行该函数。如果要控制能否瞬间移动有三种方法：
	// 1. 将全塔属性中的cannotMoveDirectly这个开关勾上，即可在全塔中全程禁止使用瞬移。
	// 2, 将楼层属性中的cannotMoveDirectly这个开关勾上，即禁止在该层楼使用瞬移。
	// 3. 将flag:cannotMoveDirectly置为true，即可使用flag控制在某段剧情范围内禁止瞬移。

	// 增加步数
	core.status.hero.steps++;
	// 更新跟随者状态，并绘制
	core.updateFollowers();
	core.drawHero();
	// 检查中毒状态的扣血和死亡
	if (core.hasFlag('poison')) {
		core.status.hero.statistics.poisonDamage += core.values.poisonDamage;
		core.status.hero.hp -= core.values.poisonDamage;
		if (core.status.hero.hp <= 0) {
			core.status.hero.hp = 0;
			core.updateStatusBar();
			core.events.lose();
			return;
		} else {
			core.updateStatusBar();
		}
	}

	// 从v2.7开始，每一步行走不会再刷新状态栏。
	// 如果有特殊要求（如每走一步都加buff之类），可手动取消注释下面这一句：
	// core.updateStatusBar(true);

	// 检查自动事件
	core.checkAutoEvents();

	// ------ 检查目标点事件 ------ //
	// 无事件的道具（如血瓶）需要优先于阻激夹域判定
	var nowx = core.getHeroLoc('x'),
		nowy = core.getHeroLoc('y');
	var block = core.getBlock(nowx, nowy);
	var hasTrigger = false;
	if (block != null && block.event.trigger == 'getItem' &&
		!core.floors[core.status.floorId].afterGetItem[nowx + "," + nowy]) {
		hasTrigger = true;
		core.trigger(nowx, nowy, callback);
	}
	// 执行目标点的阻激夹域事件
	core.checkBlock();

	// 执行目标点的script和事件
	if (!hasTrigger)
		core.trigger(nowx, nowy, callback);

	// 检查该点是否是滑冰
	if (core.onSki()) {
		// 延迟到事件最后执行，因为这之前可能有阻激夹域动画
		core.insertAction({ "type": "moveAction" }, null, null, null, true);
	}
	core.plugin.autoBattle();
	// ------ 检查目标点事件 END ------ //

	// 如需强行终止行走可以在这里条件判定：
	// core.stopAutomaticRoute();
},
        "moveDirectly": function (x, y, ignoreSteps) {
	// 瞬间移动；x,y为要瞬间移动的点；ignoreSteps为减少的步数，可能之前已经被计算过
	// 返回true代表成功瞬移，false代表没有成功瞬移

	// 判定能否瞬移到该点
	if (ignoreSteps == null) ignoreSteps = core.canMoveDirectly(x, y);
	if (ignoreSteps >= 0) {
		// 中毒也允许瞬移
		if (core.hasFlag('poison')) {
			var damage = ignoreSteps * core.values.poisonDamage;
			if (damage >= core.status.hero.hp) return false;
			core.status.hero.statistics.poisonDamage += damage;
			core.status.hero.hp -= damage;
		}
		core.drawImage("hero", "loc.png", x * 32, y * 32);
		core.drawAnimate("flash", x, y);

		core.clearMap('hero');
		// 获得勇士最后的朝向
		var lastDirection = core.status.route[core.status.route.length - 1];
		if (['left', 'right', 'up', 'down'].indexOf(lastDirection) >= 0)
			core.setHeroLoc('direction', lastDirection);
		// 设置坐标，并绘制
		core.control._moveDirectyFollowers(x, y);
		core.status.hero.loc.x = x;
		core.status.hero.loc.y = y;
		core.drawHero();
		// 记录录像
		core.status.route.push("move:" + x + ":" + y);
		// 统计信息
		core.status.hero.statistics.moveDirectly++;
		core.status.hero.statistics.ignoreSteps += ignoreSteps;
		if (core.hasFlag('poison')) {
			core.updateStatusBar();
		}
		core.checkRouteFolding();
		core.plugin.autoBattle();
		return true;
	}
	return false;
},
        "parallelDo": function (timestamp) {
	// 并行事件处理，可以在这里写任何需要并行处理的脚本或事件
	// 该函数将被系统反复执行，每次执行间隔视浏览器或设备性能而定，一般约为16.6ms一次
	// 参数timestamp为“从游戏资源加载完毕到当前函数执行时”的时间差，以毫秒为单位

	// 检查当前是否处于游戏开始状态
	if (!core.isPlaying()) return;

	// 执行当前楼层的并行事件处理
	if (core.status.floorId) {
		try {
			eval(core.floors[core.status.floorId].parallelDo);
			var m481 = ["MT481", "MT482", "MT483", "MT484", "MT485", "MT486", "MT487", "MT488", "MT489", "MT490"];
			if (m481.indexOf(core.status.floorId) != -1) {
				var lastTime = core.getFlag('lastWeatherTime', 0);
				// 每多少毫秒重绘一次；天气效果默认都是30
				if (Date.now() - lastTime > 60) {
					var lastOffsetX = core.getFlag('lastOffsetX', 0); // 上次的offset
					var image = core.material.images.images['06.jpg']; // 获得图片，这里写图片名
					var width = image.width,
						height = image.height; // 获得宽高
					// 绘制下一次，参见drawImage的API：http://www.w3school.com.cn/tags/canvas_drawimage.asp
					if (lastOffsetX + 416 > width) { // 需要首尾相接
						// 尾部
						core.canvas.bg.drawImage(image, lastOffsetX, 0, width - lastOffsetX, height, 0, 0, width - lastOffsetX, height);
						// 首部
						core.canvas.bg.drawImage(image, 0, 0, lastOffsetX + 416 - width, height, width - lastOffsetX, 0, lastOffsetX + 416 - width, height);
					} else { // 不需要，直接绘制
						core.canvas.bg.drawImage(image, lastOffsetX, 0, width, 416, 0, 0, width, 416);
					}
					// 移动图片
					lastOffsetX -= 1; // 这里是每次移动的像素
					if (lastOffsetX < 0) lastOffsetX += width;
					core.setFlag('lastOffsetX', lastOffsetX);
					core.setFlag('lastWeatherTime', timestamp); // 记录时间
				}

			}

			var h1 = ["H1", "H2", "H3", "H4", "H5", "H6", "H7", "H8", ];
			if (h1.indexOf(core.status.floorId) != -1) {
				var lastTime = core.getFlag('lastWeatherTime', 0);
				// 每多少毫秒重绘一次；天气效果默认都是30
				if (Date.now() - lastTime > 60) {
					var lastOffsetX = core.getFlag('lastOffsetX', 0); // 上次的offset
					var image = core.material.images.images['07.jpg']; // 获得图片，这里写图片名
					var width = image.width,
						height = image.height; // 获得宽高
					// 绘制下一次，参见drawImage的API：http://www.w3school.com.cn/tags/canvas_drawimage.asp
					if (lastOffsetX + 416 > width) { // 需要首尾相接
						// 尾部
						core.canvas.bg.drawImage(image, lastOffsetX, 0, width - lastOffsetX, height, 0, 0, width - lastOffsetX, height);
						// 首部
						core.canvas.bg.drawImage(image, 0, 0, lastOffsetX + 416 - width, height, width - lastOffsetX, 0, lastOffsetX + 416 - width, height);
					} else { // 不需要，直接绘制
						core.canvas.bg.drawImage(image, lastOffsetX, 0, width, 416, 0, 0, width, 416);
					}
					// 移动图片
					lastOffsetX += 2; // 这里是每次移动的像素
					if (lastOffsetX > 416) lastOffsetX -= width;
					core.setFlag('lastOffsetX', lastOffsetX);
					core.setFlag('lastWeatherTime', timestamp); // 记录时间
				}
			}

			var m806 = ["MT806", "MT807", "MT808", "MT809", "MT810", "MT811", "MT812", "MT813", "MT814", "MT815", "MT816", "MT817", "MT818", "MT819", "MT820", "MT821", "MT822", "MT823", "MT824", "MT825"];
			if (m806.indexOf(core.status.floorId) != -1) {
				var lastTime = core.getFlag('lastWeatherTime', 0);
				// 每多少毫秒重绘一次；天气效果默认都是30
				if (Date.now() - lastTime > 60) {
					var lastOffsetX = core.getFlag('lastOffsetX', 0); // 上次的offset
					var image = core.material.images.images['16.jpg']; // 获得图片，这里写图片名
					var width = image.width,
						height = image.height; // 获得宽高
					// 绘制下一次，参见drawImage的API：http://www.w3school.com.cn/tags/canvas_drawimage.asp
					if (lastOffsetX + 416 > width) { // 需要首尾相接
						// 尾部
						core.canvas.bg.drawImage(image, lastOffsetX, 0, width - lastOffsetX, height, 0, 0, width - lastOffsetX, height);
						// 首部
						core.canvas.bg.drawImage(image, 0, 0, lastOffsetX + 416 - width, height, width - lastOffsetX, 0, lastOffsetX + 416 - width, height);
					} else { // 不需要，直接绘制
						core.canvas.bg.drawImage(image, lastOffsetX, 0, width, 416, 0, 0, width, 416);
					}
					// 移动图片
					lastOffsetX -= 1.5; // 这里是每次移动的像素
					if (lastOffsetX < 0) lastOffsetX += width;
					core.setFlag('lastOffsetX', lastOffsetX);
					core.setFlag('lastWeatherTime', timestamp); // 记录时间
				}

			}

			var n1 = ["N1", "N2", "N3", "N4", "N5", "N6", "N7", "N8", "N9", "N10", "N11", "N12", "N13", "N14", "N15", "N16"];
			if (n1.indexOf(core.status.floorId) != -1) {
				var lastTime = core.getFlag('lastWeatherTime', 0);
				// 每多少毫秒重绘一次；天气效果默认都是30
				if (Date.now() - lastTime > 60) {
					var lastOffsetX = core.getFlag('lastOffsetX', 0); // 上次的offset
					var image = core.material.images.images['17.jpg']; // 获得图片，这里写图片名
					var width = image.width,
						height = image.height; // 获得宽高
					// 绘制下一次，参见drawImage的API：http://www.w3school.com.cn/tags/canvas_drawimage.asp
					if (lastOffsetX + 416 > width) { // 需要首尾相接
						// 尾部
						core.canvas.bg.drawImage(image, lastOffsetX, 0, width - lastOffsetX, height, 0, 0, width - lastOffsetX, height);
						// 首部
						core.canvas.bg.drawImage(image, 0, 0, lastOffsetX + 416 - width, height, width - lastOffsetX, 0, lastOffsetX + 416 - width, height);
					} else { // 不需要，直接绘制
						core.canvas.bg.drawImage(image, lastOffsetX, 0, width, 416, 0, 0, width, 416);
					}
					// 移动图片
					lastOffsetX += 2.5; // 这里是每次移动的像素
					if (lastOffsetX > 416) lastOffsetX -= width;
					core.setFlag('lastOffsetX', lastOffsetX);
					core.setFlag('lastWeatherTime', timestamp); // 记录时间
				}
			}


		} catch (e) {
			main.log(e);
		}
	}
}
    },
    "ui": {
        "getToolboxItems": function (cls) {
	// 获得道具栏中当前某类型道具的显示项和显示顺序
	// cls为道具类型，只可能是 tools, constants 和 equips
	// 返回一个数组，代表当前某类型道具的显示内容和顺序
	// 默认按id升序排列，您可以取消下面的注释改为按名称排列

	return Object.keys(core.status.hero.items[cls] || {})
		.filter(function (id) { return !core.material.items[id].hideInToolbox; })
		.sort( /*function (id1, id2) { return core.material.items[id1].name <= core.material.items[id2].name ? -1 : 1 }*/ );
},
        "drawStatusBar": function () {
	// 自定义绘制状态栏，需要开启状态栏canvas化

	// 如果是非状态栏canvas化，直接返回
	if (!core.flags.statusCanvas) return;
	var ctx = core.dom.statusCanvasCtx;
	// 清空状态栏
	core.clearMap(ctx);
	// 如果是隐藏状态栏模式，直接返回
	if (!core.domStyle.showStatusBar) return;

	// 作为样板，只绘制楼层、生命、攻击、防御、护盾、金币、钥匙这七个内容
	// 需要其他的请自行进行修改；横竖屏都需要进行适配绘制。
	// （可以使用Chrome浏览器开控制台来模拟手机上的竖屏模式的显示效果，具体方式自行百度）
	// 横屏模式下的画布大小是 129*416
	// 竖屏模式下的画布大小是 416*(32*rows+9) 其中rows为状态栏行数，即全塔属性中statusCanvasRowsOnMobile值
	// 可以使用 core.domStyle.isVertical 来判定当前是否是竖屏模式

	core.setFillStyle(ctx, core.status.globalAttribute.statusBarColor || core.initStatus.globalAttribute.statusBarColor);

	// 绘制一段文字，带斜体判定
	var _fillBoldTextWithFontCheck = function (text, x, y, style) {
		// 斜体判定：如果不是纯数字和字母，斜体会非常难看，需要取消
		if (!/^[-a-zA-Z0-9`~!@#$%^&*()_=+\[{\]}\\|;:'",<.>\/?]*$/.test(text))
			core.setFont(ctx, 'bold 14px nake2');
		else core.setFont(ctx, 'italic bold 14px nake2');
		core.fillBoldText(ctx, text, x, y, style);
	}

	// 横竖屏需要分别绘制...
	core.setTextAlign(ctx, 'center');
	if (!core.domStyle.isVertical) {
		// 横屏模式
		//core.drawLine(ctx, 1, 30, 129, 30, "#FFFFFF", 1);
		//core.drawLine(ctx, 1, 60, 129, 60, "#FFFFFF", 1);
		//core.drawLine(ctx, 46, 30, 61, 60, "#FFFFFF", 1);
		//core.drawLine(ctx, 1, 88, 129, 88, "#FFFFFF", 1);
		//core.drawLine(ctx, 1, 116, 64.5, 116, "#FFFFFF", 1);
		//core.drawLine(ctx, 1, 122, 129, 122, "#FFFFFF", 1);
		core.drawLine(ctx, 1, 147, 129, 147, "#FFFFFF", 1);
		core.drawLine(ctx, 1, 172, 129, 172, "#FFFFFF", 1);
		core.drawLine(ctx, 1, 197, 129, 197, "#FFFFFF", 1);
		core.drawLine(ctx, 1, 222, 129, 222, "#FFFFFF", 1);
		core.drawLine(ctx, 1, 248, 129, 248, "#FFFFFF", 1);
		core.drawLine(ctx, 23, 248, 23, 299, "#FFFFFF", 1);
		core.drawLine(ctx, 1, 299, 129, 299, "#FFFFFF", 1);



		if (core.hasItem('I581')) { core.drawImage(ctx, 'E.png', 34, 368, 60, 60); } else if (core.hasItem('I582')) { core.drawImage(ctx, 'H.png', 34, 368, 60, 60); } else { core.drawImage(ctx, 'C.png', 34, 368, 60, 60); }

		//wl
		if (core.getFlag("wlzt", 0) > 0) {
			_fillBoldTextWithFontCheck(core.getFlag('wl', 0), 12, 415, "#dea0e8");
		}

		//特殊状态
		if (core.getFlag("s113", 0) > 0) {
			_fillBoldTextWithFontCheck(('⤨'), 5, 14, '#bfe7f2');
		}
		if (core.getFlag("s114", 0) > 0) {
			_fillBoldTextWithFontCheck(('☁️'), 15, 14, '#9da1c7');
		}
		if (core.getFlag("s157", 0) > 0) {
			_fillBoldTextWithFontCheck(('☁️'), 15, 14, '#9da1c7');
		}
		if (core.getFlag("s120", 0) > 0) {
			_fillBoldTextWithFontCheck(('♢'), 25, 14, '#bafff6');
		}
		if (core.getFlag("s121", 0) > 0) {
			_fillBoldTextWithFontCheck(('♡'), 35, 14, '#8474ed');
		}
		if (core.getFlag("s141", 0) > 0) {
			_fillBoldTextWithFontCheck(('✿'), 95, 14, '#aaebab');
		}
		if (core.getFlag("s142", 0) > 0) {
			_fillBoldTextWithFontCheck(('☀'), 105, 14, '#ebbdaa');
		}
		if (core.getFlag("s143", 0) > 0) {
			_fillBoldTextWithFontCheck(('▣'), 115, 14, '#ceccd4');
		}
		if (core.hasItem('I1788')) {
			_fillBoldTextWithFontCheck(parseFloat(((core.itemCount('I1788') + 1)).toFixed(2)) + 'x', 110, 410, '#ff8299');
		}


		// 绘制楼层
		//core.drawImage(ctx, core.statusBar.icons.floor, 3, 7, 18, 18);
		_fillBoldTextWithFontCheck((core.status.thisMap || {}).name || "", 64, 13, '#66CCFF');
		core.drawImage(ctx, 'snow.png', 4.5, 16, 120, 109);
		// 绘制勇士
		//core.drawImage(ctx, 'hero1.png', 3, 33, 16, 24);
		_fillBoldTextWithFontCheck(core.status.hero.name, 102, 39, "#c69ce6");
		//心境之石
		if (core.hasItem('I1187')) {
			core.drawImage(ctx, 'sto.png', 59, 19, 20, 20);
			_fillBoldTextWithFontCheck(core.itemCount('I1187'), 83, 34, '#83a6de');
		}
		if (core.hasItem('I1418')) {
			core.drawImage(ctx, 'sal.png', 69, 19, 20, 20);
		}

		if (core.hasItem('I955')) {

			_fillBoldTextWithFontCheck(core.formatBigNumber(core.getRealStatus('money')), 64, 411, "#ffa1db");
		}

		// 绘制等级
		//core.drawImage(ctx, core.statusBar.icons.lv, 76, 38, 16, 16);
		//_fillBoldTextWithFontCheck(core.getLvName(), 91, 51, "#FFD800");
		if (core.status.hero.lv <= 36) {
			if (core.status.hero.lv <= 5) {
				_fillBoldTextWithFontCheck(core.getLvName(), 64, 125, "#FFFFFF");
			}
			if (core.status.hero.lv >= 6) {
				_fillBoldTextWithFontCheck(core.getLvName(), 64, 125, "#75E97E");
			}
			if (core.status.hero.lv >= 10) {
				_fillBoldTextWithFontCheck(core.getLvName(), 64, 125, "#6FAEE4");
			}
			if (core.status.hero.lv >= 15) {
				_fillBoldTextWithFontCheck(core.getLvName(), 64, 125, "#C76EE7");
			}
		}
		if (core.status.hero.lv >= 20) {
			_fillBoldTextWithFontCheck(core.getLvName(), 64, 125, "#E06BBB");
		}
		if (core.status.hero.lv >= 26) {
			_fillBoldTextWithFontCheck(core.getLvName(), 64, 125, "#F0EA28");
		}
		if (core.status.hero.lv >= 34) {
			_fillBoldTextWithFontCheck(core.getLvName(), 64, 125, "#EA4444");
		}
		if (core.status.hero.lv >= 118) {
			_fillBoldTextWithFontCheck(core.getLvName(), 64, 115, "#AEAFAF");
		}
		if (core.status.hero.lv >= 351) {
			_fillBoldTextWithFontCheck(core.getLvName(), 64, 115, "#333333");
		}
		if (core.status.hero.lv >= 411) {
			_fillBoldTextWithFontCheck(core.getLvName(), 64, 115, "#333333");
		}
		if (core.status.hero.lv >= 471) {
			_fillBoldTextWithFontCheck(core.getLvName(), 64, 115, "#A81F7D");
		}
		if (core.status.hero.lv >= 501) {
			_fillBoldTextWithFontCheck(core.getLvName(), 64, 115, "#E6E383");
		}
		if (core.status.hero.lv >= 631) {
			_fillBoldTextWithFontCheck(core.getLvName(), 64, 115, "#FFF700");
		}
		if (core.status.hero.lv >= 751) {
			_fillBoldTextWithFontCheck(core.getLvName(), 64, 115, "#ECBF6C");
		}
		if (core.status.hero.lv >= 871) {
			_fillBoldTextWithFontCheck(core.getLvName(), 64, 115, "#FF9B05");
		}
		if (core.status.hero.lv >= 1000) {
			_fillBoldTextWithFontCheck(core.getLvName(), 64, 115, "#FF0000");
		}

		if (core.getFlag("newlv", 0) > 0) {
			var infrealm = core.getFlag("newlv");
			if (infrealm == 1) {
				{ _fillBoldTextWithFontCheck(('春醒'), 64, 112, '#75E97E'); }
			} else if (infrealm == 2) {
				{ _fillBoldTextWithFontCheck(('夏醉'), 64, 112, '#75E97E'); }
			} else if (infrealm == 3) {
				{ _fillBoldTextWithFontCheck(('秋苏'), 64, 112, '#75E97E'); }
			} else if (infrealm == 4) {
				{ _fillBoldTextWithFontCheck(('冬寂'), 64, 112, '#75E97E'); }
			} else if (infrealm == 5) {
				{ _fillBoldTextWithFontCheck(('结茧「一始」'), 64, 112, '#6FAEE4'); }
			} else if (infrealm == 6) {
				{ _fillBoldTextWithFontCheck(('茧动「双生」'), 64, 112, '#6FAEE4'); }
			} else if (infrealm == 7) {
				{ _fillBoldTextWithFontCheck(('化蝶「三才」'), 64, 112, '#6FAEE4'); }
			} else if (infrealm == 8) {
				{ _fillBoldTextWithFontCheck(('摇光「四相」'), 64, 112, '#6FAEE4'); }
			} else if (infrealm == 9) {
				{ _fillBoldTextWithFontCheck(('拾露「五行」'), 64, 112, '#6FAEE4'); }
			} else if (infrealm == 10) {
				{ _fillBoldTextWithFontCheck(('腐泥期'), 64, 112, '#C76EE7'); }
			} else if (infrealm == 11) {
				{ _fillBoldTextWithFontCheck(('晶凝期'), 64, 112, '#C76EE7'); }
			} else if (infrealm == 12) {
				{ _fillBoldTextWithFontCheck(('汐动期'), 64, 112, '#C76EE7'); }
			} else if (infrealm == 13) {
				{ _fillBoldTextWithFontCheck(('归灵期'), 64, 112, '#C76EE7'); }
			} else if (infrealm == 14) {
				{ _fillBoldTextWithFontCheck(('解月期'), 64, 112, '#C76EE7'); }
			} else if (infrealm == 15) {
				{ _fillBoldTextWithFontCheck(('新月'), 64, 112, '#E06BBB'); }
			} else if (infrealm == 16) {
				{ _fillBoldTextWithFontCheck(('娥眉月'), 64, 112, '#E06BBB'); }
			} else if (infrealm == 17) {
				{ _fillBoldTextWithFontCheck(('上弦月'), 64, 112, '#E06BBB7'); }
			} else if (infrealm == 18) {
				{ _fillBoldTextWithFontCheck(('盈凸'), 64, 112, '#E06BBB'); }
			} else if (infrealm == 19) {
				{ _fillBoldTextWithFontCheck(('满月'), 64, 112, '#E06BBB'); }
			} else if (infrealm == 20) {
				{ _fillBoldTextWithFontCheck(('域种'), 64, 112, '#E06BBB'); }
			} else if (infrealm == 21) {
				{ _fillBoldTextWithFontCheck(('星胚域'), 64, 112, '#F0EA28'); }
			} else if (infrealm == 22) {
				{ _fillBoldTextWithFontCheck(('雏星域'), 64, 112, '#F0EA28'); }
			} else if (infrealm == 23) {
				{ _fillBoldTextWithFontCheck(('谐生域'), 64, 112, '#F0EA28'); }
			} else if (infrealm == 24) {
				{ _fillBoldTextWithFontCheck(('织梦域'), 64, 112, '#F0EA28'); }
			} else if (infrealm == 25) {
				{ _fillBoldTextWithFontCheck(('三千域'), 64, 112, '#F0EA28'); }
			} else if (infrealm == 26) {
				{ _fillBoldTextWithFontCheck(('元宙域'), 64, 112, '#F0EA28'); }
			} else if (infrealm == 27) {
				{ _fillBoldTextWithFontCheck(('形印域'), 64, 112, '#F0EA28'); }
			}
		}

		// 绘制生命
		//core.drawImage(ctx, core.statusBar.icons.hp, 15, 64, 20, 20);
		core.drawImage(ctx, 'hp.png', 15, 125, 20, 20);
		_fillBoldTextWithFontCheck(core.formatBigNumber(core.getRealStatus('hp')), 78, 140, "#d64fdb");

		// 绘制攻击
		//core.drawImage(ctx, core.statusBar.icons.atk, 3, 94, 16, 16);
		core.drawImage(ctx, 'a.png', 15, 150, 20, 20);
		_fillBoldTextWithFontCheck(core.formatBigNumber(core.getRealStatus('atk')), 78, 165, "#e65353");

		if (core.getFlag("magicAtk", 0) > 0) {
			_fillBoldTextWithFontCheck(core.getFlag('magicAtk', 0), 110, 172, "#e8b2e4");
		}


		// 绘制防御
		//core.drawImage(ctx, core.statusBar.icons.def, 3, 122, 16, 16);
		core.drawImage(ctx, 'd.png', 15, 175, 20, 20);
		_fillBoldTextWithFontCheck(core.formatBigNumber(core.getRealStatus('def')), 78, 190, "#5370e6");

		// 绘制护盾
		//core.drawImage(ctx, core.statusBar.icons.mdef, 0, 147, 22, 22);
		core.drawImage(ctx, 'm.png', 15, 200, 20, 20);
		_fillBoldTextWithFontCheck(core.formatBigNumber(core.getRealStatus('mdef')), 78, 215, "#36e044");

		// 绘制金币
		//core.drawImage(ctx, core.statusBar.icons.money, 64, 97, 24, 24);
		//_fillBoldTextWithFontCheck(core.formatBigNumber(core.status.hero.money), 96, 114, "#FFD700");

		_fillBoldTextWithFontCheck(('Next'), 22, 240, '#9ce0d8');

		// 绘制经验
		//core.drawImage(ctx, core.statusBar.icons.up, 68, 143, 16, 16);
		if (core.getRealStatus('lv') <= 999) { _fillBoldTextWithFontCheck(core.formatBigNumber(core.firstData.levelUp[core.status.hero.lv].need - core.status.hero.exp), 76, 240, "#f2b1e9"); } else { _fillBoldTextWithFontCheck(('∞'), 102, 92, "#f2b1e9"); }

		// 绘制四色钥匙
		_fillBoldTextWithFontCheck(('异'), 11, 265, '#9ce0d8');
		_fillBoldTextWithFontCheck(('常'), 11, 280, '#9ce0d8');
		_fillBoldTextWithFontCheck(('栏'), 11, 295, '#9ce0d8');

		core.drawImage(ctx, 'p.png', 10, 375, 20, 20);
		_fillBoldTextWithFontCheck(core.itemCount('pickaxe'), 17, 410, '#808080');
		core.drawImage(ctx, 'z.png', 100, 375, 20, 20);
		_fillBoldTextWithFontCheck(core.itemCount('bomb'), 107, 410, '#f86e7f');

		// 绘制负面状态
		//var left = 0;
		//var right = 129;
		//_fillBoldTextWithFontCheck('禀赋:' + (core.itemCount('I658') + 1) + 'x', 60.5, 247, '#ebc36c');

		//_fillBoldTextWithFontCheck('能力加成:' + ((core.itemCount('I821') + 1) * 100) / 100 + 'x', 60.5, 275, '#6ca3eb');




	} else {
		// 竖屏模式
		//core.drawLine(ctx, 139, 1, 139, 35, "#FFFFFF", 1);
		//core.drawLine(ctx, 139, 107, 139, 137, "#FFFFFF", 1);
		//core.drawLine(ctx, 107, 59, 204, 59, "#FFFFFF", 1);
		//core.drawLine(ctx, 1, 83, 204, 83, "#FFFFFF", 1);
		//core.drawLine(ctx, 107, 35, 107, 107, "#FFFFFF", 1);
		//core.drawLine(ctx, 204, 35, 204, 107, "#FFFFFF", 1);
		core.drawLine(ctx, 196, 1, 196, 137, "#FFFFFF", 1);
		core.drawLine(ctx, 296, 1, 296, 137, "#FFFFFF", 1);
		core.drawLine(ctx, 196, 27, 296, 27, "#FFFFFF", 1);
		core.drawLine(ctx, 196, 54, 296, 54, "#FFFFFF", 1);
		core.drawLine(ctx, 196, 81, 296, 81, "#FFFFFF", 1);
		core.drawLine(ctx, 196, 108, 296, 108, "#FFFFFF", 1);
		//core.drawLine(ctx, 1, 107, 416, 107, "#FFFFFF", 1);
		//core.drawLine(ctx, 188, 1, 204, 35, "#FFFFFF", 1);
		//core.drawLine(ctx, 204, 72, 296, 72, "#FFFFFF", 1);

		// 绘制楼层
		//core.drawImage(ctx, core.statusBar.icons.floor, 6, 9, 18, 18);
		_fillBoldTextWithFontCheck((core.status.thisMap || {}).name || "", 246, 19, '#66CCFF');
		core.drawImage(ctx, 'snow.png', 0, 0, 123, 107);

		//新栏
		if (core.hasItem('I955')) {
			if (core.getRealStatus('lv') <= 999) { _fillBoldTextWithFontCheck(core.formatBigNumber(core.firstData.levelUp[core.status.hero.lv].need - core.status.hero.exp), 158, 63, "#f2b1e9"); } else {
				_fillBoldTextWithFontCheck(('∞'), 158, 60, "#f2b1e9");
			}
			_fillBoldTextWithFontCheck(core.status.hero.name, 158, 20, "#c69ce6");
			_fillBoldTextWithFontCheck(('Next'), 158, 42, '#9ce0d8');
			_fillBoldTextWithFontCheck(('领悟'), 158, 83, '#edeb63');
			_fillBoldTextWithFontCheck(core.formatBigNumber(core.status.hero.money), 158, 104, "#ffa1db");

		} else {
			if (core.getRealStatus('lv') <= 999) { _fillBoldTextWithFontCheck(core.formatBigNumber(core.firstData.levelUp[core.status.hero.lv].need - core.status.hero.exp), 158, 90, "#f2b1e9"); } else {
				_fillBoldTextWithFontCheck(('∞'), 158, 90, "#f2b1e9");
			}
			_fillBoldTextWithFontCheck(core.status.hero.name, 158, 30, "#c69ce6");
			_fillBoldTextWithFontCheck(('Next'), 158, 60, '#9ce0d8');

		}

		// 绘制难度
		if (core.hasItem('I581')) { core.drawImage(ctx, 'E.png', 128, 92, 56, 56); } else if (core.hasItem('I582')) { core.drawImage(ctx, 'H.png', 128, 92, 56, 56); } else { core.drawImage(ctx, 'C.png', 128, 92, 56, 56); }

		// 绘制勇士
		//_fillBoldTextWithFontCheck(core.status.hero.name, 158, 30, "#c69ce6");
		//_fillBoldTextWithFontCheck(('Next'), 157, 60, '#9ce0d8');

		//心境之石
		if (core.hasItem('I1187')) {

			core.drawImage(ctx, 'sto.png', 96, 86, 27, 27);
			_fillBoldTextWithFontCheck(core.itemCount('I1187'), 128, 105, '#83a6de');
		}

		if (core.hasItem('I1418')) {

			core.drawImage(ctx, 'sal.png', 106, 86, 27, 27);
		}

		//特殊状态
		if (core.getFlag("s113", 0) > 0) {
			_fillBoldTextWithFontCheck(('⤨'), 305, 14, '#bfe7f2');
		}
		if (core.getFlag("s114", 0) > 0) {
			_fillBoldTextWithFontCheck(('☁️'), 315, 14, '#9da1c7');
		}
		if (core.getFlag("s157", 0) > 0) {
			_fillBoldTextWithFontCheck(('☁️'), 315, 14, '#9da1c7');
		}
		if (core.getFlag("s120", 0) > 0) {
			_fillBoldTextWithFontCheck(('♢'), 325, 14, '#bafff6');
		}
		if (core.getFlag("s121", 0) > 0) {
			_fillBoldTextWithFontCheck(('♡'), 335, 14, '#8474ed');
		}
		if (core.getFlag("s141", 0) > 0) {
			_fillBoldTextWithFontCheck(('✿'), 345, 14, '#aaebab');
		}
		if (core.getFlag("s142", 0) > 0) {
			_fillBoldTextWithFontCheck(('☀'), 355, 14, '#ebbdaa');
		}
		if (core.getFlag("s143", 0) > 0) {
			_fillBoldTextWithFontCheck(('▣'), 365, 14, '#ceccd4');
		}

		// 绘制等级
		//core.drawImage(ctx, core.statusBar.icons.lv, 220, 11, 16, 16);
		//_fillBoldTextWithFontCheck(core.getLvName(), 240, 24, "#FFD800");
		//wl
		if (core.getFlag("wlzt", 0) > 0) {
			_fillBoldTextWithFontCheck(core.getFlag('wl', 0), 10, 135, "#dea0e8");
		}

		if (core.status.hero.lv <= 36) {
			if (core.status.hero.lv <= 5) {
				_fillBoldTextWithFontCheck(core.getLvName(), 64, 128, "#FFFFFF");
			}
			if (core.status.hero.lv >= 6) {
				_fillBoldTextWithFontCheck(core.getLvName(), 64, 133, "#75E97E");
			}
			if (core.status.hero.lv >= 10) {
				_fillBoldTextWithFontCheck(core.getLvName(), 64, 133, "#6FAEE4");
			}
			if (core.status.hero.lv >= 15) {
				_fillBoldTextWithFontCheck(core.getLvName(), 64, 133, "#C76EE7");
			}
			if (core.status.hero.lv >= 20) {
				_fillBoldTextWithFontCheck(core.getLvName(), 64, 133, "#E06BBB");
			}
			if (core.status.hero.lv >= 26) {
				_fillBoldTextWithFontCheck(core.getLvName(), 64, 133, "#F0EA28");
			}
			if (core.status.hero.lv >= 34) {
				_fillBoldTextWithFontCheck(core.getLvName(), 64, 133, "#EA4444");
			}
		}

		if (core.status.hero.lv >= 37) {
			_fillBoldTextWithFontCheck(core.getLvName(), 64, 133, "#E06BBB");
		}
		if (core.status.hero.lv >= 64) {
			_fillBoldTextWithFontCheck(core.getLvName(), 64, 133, "#F0EA28");
		}
		if (core.status.hero.lv >= 91) {
			_fillBoldTextWithFontCheck(core.getLvName(), 64, 133, "#EA4444");
		}
		if (core.status.hero.lv >= 118) {
			_fillBoldTextWithFontCheck(core.getLvName(), 64, 133, "#AEAFAF");
		}
		if (core.status.hero.lv >= 351) {
			_fillBoldTextWithFontCheck(core.getLvName(), 64, 133, "#333333");
		}
		if (core.status.hero.lv >= 411) {
			_fillBoldTextWithFontCheck(core.getLvName(), 64, 133, "#333333");
		}
		if (core.status.hero.lv >= 471) {
			_fillBoldTextWithFontCheck(core.getLvName(), 63, 128, "#A81F7D");
		}
		if (core.status.hero.lv >= 501) {
			_fillBoldTextWithFontCheck(core.getLvName(), 63, 128, "#E6E383");
		}
		if (core.status.hero.lv >= 631) {
			_fillBoldTextWithFontCheck(core.getLvName(), 63, 128, "#FFF700");
		}
		if (core.status.hero.lv >= 751) {
			_fillBoldTextWithFontCheck(core.getLvName(), 63, 128, "#ECBF6C");
		}
		if (core.status.hero.lv >= 871) {
			_fillBoldTextWithFontCheck(core.getLvName(), 63, 128, "#FF9B05");
		}
		if (core.status.hero.lv >= 1000) {
			_fillBoldTextWithFontCheck(core.getLvName(), 63, 128, "#FF0000");
		}




		if (core.getFlag("newlv", 0) > 0) {
			var infrealm = core.getFlag("newlv");
			if (infrealm == 1) {
				{ _fillBoldTextWithFontCheck(('春醒'), 64, 117, '#75E97E'); }
			} else if (infrealm == 2) {
				{ _fillBoldTextWithFontCheck(('夏醉'), 64, 117, '#75E97E'); }
			} else if (infrealm == 3) {
				{ _fillBoldTextWithFontCheck(('秋苏'), 64, 117, '#75E97E'); }
			} else if (infrealm == 4) {
				{ _fillBoldTextWithFontCheck(('冬寂'), 64, 117, '#75E97E'); }
			} else if (infrealm == 5) {
				{ _fillBoldTextWithFontCheck(('结茧「一始」'), 64, 117, '#6FAEE4'); }
			} else if (infrealm == 6) {
				{ _fillBoldTextWithFontCheck(('茧动「双生」'), 64, 117, '#6FAEE4'); }
			} else if (infrealm == 7) {
				{ _fillBoldTextWithFontCheck(('化蝶「三才」'), 64, 117, '#6FAEE4'); }
			} else if (infrealm == 8) {
				{ _fillBoldTextWithFontCheck(('摇光「四相」'), 64, 117, '#6FAEE4'); }
			} else if (infrealm == 9) {
				{ _fillBoldTextWithFontCheck(('拾露「五行」'), 64, 117, '#6FAEE4'); }
			} else if (infrealm == 10) {
				{ _fillBoldTextWithFontCheck(('腐泥期'), 64, 117, '#C76EE7'); }
			} else if (infrealm == 11) {
				{ _fillBoldTextWithFontCheck(('晶凝期'), 64, 117, '#C76EE7'); }
			} else if (infrealm == 12) {
				{ _fillBoldTextWithFontCheck(('汐动期'), 64, 117, '#C76EE7'); }
			} else if (infrealm == 13) {
				{ _fillBoldTextWithFontCheck(('归灵期'), 64, 117, '#C76EE7'); }
			} else if (infrealm == 14) {
				{ _fillBoldTextWithFontCheck(('解月期'), 64, 117, '#C76EE7'); }
			} else if (infrealm == 15) {
				{ _fillBoldTextWithFontCheck(('新月'), 64, 117, '#E06BBB'); }
			} else if (infrealm == 16) {
				{ _fillBoldTextWithFontCheck(('娥眉月'), 64, 117, '#E06BBB'); }
			} else if (infrealm == 17) {
				{ _fillBoldTextWithFontCheck(('上弦月'), 64, 117, '#E06BBB7'); }
			} else if (infrealm == 18) {
				{ _fillBoldTextWithFontCheck(('盈凸'), 64, 117, '#E06BBB'); }
			} else if (infrealm == 19) {
				{ _fillBoldTextWithFontCheck(('满月'), 64, 117, '#E06BBB'); }
			} else if (infrealm == 20) {
				{ _fillBoldTextWithFontCheck(('域种'), 64, 117, '#E06BBB'); }
			} else if (infrealm == 21) {
				{ _fillBoldTextWithFontCheck(('星胚域'), 64, 117, '#F0EA28'); }
			} else if (infrealm == 22) {
				{ _fillBoldTextWithFontCheck(('雏星域'), 64, 117, '#F0EA28'); }
			} else if (infrealm == 23) {
				{ _fillBoldTextWithFontCheck(('谐生域'), 64, 117, '#F0EA28'); }
			} else if (infrealm == 24) {
				{ _fillBoldTextWithFontCheck(('织梦域'), 64, 117, '#F0EA28'); }
			} else if (infrealm == 25) {
				{ _fillBoldTextWithFontCheck(('三千域'), 64, 117, '#F0EA28'); }
			} else if (infrealm == 26) {
				{ _fillBoldTextWithFontCheck(('元宙域'), 64, 117, '#F0EA28'); }
			} else if (infrealm == 27) {
				{ _fillBoldTextWithFontCheck(('形印域'), 64, 117, '#F0EA28'); }
			}
		}

		// 绘制生命
		//core.drawImage(ctx, core.statusBar.icons.hp, 15, 64, 20, 20);
		core.drawImage(ctx, 'hp.png', 205, 30, 20, 20);
		_fillBoldTextWithFontCheck(core.formatBigNumber(core.getRealStatus('hp')), 258, 45, "#d64fdb");

		// 绘制攻击
		//core.drawImage(ctx, core.statusBar.icons.atk, 3, 94, 16, 16);
		core.drawImage(ctx, 'a.png', 205, 57, 20, 20);
		_fillBoldTextWithFontCheck(core.formatBigNumber(core.getRealStatus('atk')), 258, 72, "#e65353");

		// 绘制防御
		//core.drawImage(ctx, core.statusBar.icons.def, 3, 122, 16, 16);
		core.drawImage(ctx, 'd.png', 205, 84, 20, 20);
		_fillBoldTextWithFontCheck(core.formatBigNumber(core.getRealStatus('def')), 258, 99, "#5370e6");

		// 绘制护盾
		//core.drawImage(ctx, core.statusBar.icons.mdef, 0, 147, 22, 22);
		core.drawImage(ctx, 'm.png', 205, 111, 20, 20);
		_fillBoldTextWithFontCheck(core.formatBigNumber(core.getRealStatus('mdef')), 258, 126, "#36e044");



		// 绘制金币
		//core.drawImage(ctx, core.statusBar.icons.money, 2, 59, 24, 24);
		//_fillBoldTextWithFontCheck(core.formatBigNumber(core.status.hero.money), 53, 77, "#FFD700");

		// 绘制经验
		//core.drawImage(ctx, core.statusBar.icons.up, 6, 87, 16, 16);
		//if (core.getRealStatus('lv') <= 999) { _fillBoldTextWithFontCheck(core.formatBigNumber(core.firstData.levelUp[core.status.hero.lv].need - core.status.hero.exp), 158, 90, "#f2b1e9"); } else { _fillBoldTextWithFontCheck(('∞'), 158, 90, "#f2b1e9"); }

		// 绘制四色钥匙
		_fillBoldTextWithFontCheck(('道 具 栏'), 357, 29, '#9ce0d8');
		//core.drawImage(ctx, 'y.png', 303, 49, 16, 16);
		//_fillBoldTextWithFontCheck(core.itemCount('yellowKey'), 328, 63, '#FFCCAA');
		//core.drawImage(ctx, 'b.png', 340, 49, 16, 16);
		//_fillBoldTextWithFontCheck(core.itemCount('blueKey'), 365, 63, '#AAAADD');
		//core.drawImage(ctx, 'r.png', 377, 49, 16, 16);
		//_fillBoldTextWithFontCheck(core.itemCount('redKey'), 402, 63, '#FF8888');
		core.drawImage(ctx, 'p.png', 315, 76, 16, 16);
		_fillBoldTextWithFontCheck(core.itemCount('pickaxe'), 340, 90, '#808080');
		core.drawImage(ctx, 'z.png', 365, 76, 16, 16);
		_fillBoldTextWithFontCheck(core.itemCount("bomb"), 390, 90, '#f86e7f');
		//core.drawImage(ctx, 'a2.png', 377, 76, 16, 16);
		//_fillBoldTextWithFontCheck(core.itemCount('I733'), 402, 90, '#FFF0F5');
		//core.drawImage(ctx, 'f.png', 303, 103, 16, 16);
		//_fillBoldTextWithFontCheck(core.itemCount('centerFly'), 328, 117, '#F4A460');
		//core.drawImage(ctx, 'lv.png', 340, 103, 16, 16);
		//_fillBoldTextWithFontCheck(core.itemCount('greenKey'), 365, 117, 'LightGreen');
		//core.drawImage(ctx, "lm.png", 377, 103, 16, 16);
		//_fillBoldTextWithFontCheck(core.getFlag('saltygreen', 0), 402, 117, "#4ded42");

		if (core.hasItem('I1788')) {
			_fillBoldTextWithFontCheck(parseFloat(((core.itemCount('I1788') + 1)).toFixed(2)) + 'x', 130, 90, '#ff8299');
		}



		// 绘制禀赋
		//_fillBoldTextWithFontCheck('禀赋', 250, 50, '#ebc36c');
		//_fillBoldTextWithFontCheck((core.itemCount('I658') + 1) + 'x', 250, 66, '#ebc36c');

		// 绘制能力加成
		//_fillBoldTextWithFontCheck('能力加成', 250, 86, '#6ca3eb');
		//_fillBoldTextWithFontCheck(((core.itemCount('I821') + 1) * 100) / 100 + 'x', 250, 102, '#6ca3eb');
	}
},
        "drawStatistics": function () {
	// 浏览地图时参与的统计项目

	return [
		'yellowDoor', 'blueDoor', 'redDoor', 'greenDoor', 'steelDoor',
		'yellowKey', 'blueKey', 'redKey', 'steelKey',
		'redGem', 'blueGem', 'greenGem', 'yellowGem', 'I576', 'I577', 'I578', 'I579', 'I584', 'I585', 'I586', 'I587',
		'I635', 'I636', 'I637', 'I638', 'I639', 'I640', 'I641', 'I642', 'I643', 'I644', 'I645', 'I646',
		'redPotion', 'bluePotion', 'yellowPotion', 'greenPotion', 'superPotion', 'poisonWine', 'weakWine', 'I572', 'curseWine', 'I619', 'I620', 'I621', 'I622',
		'I1009', 'I1010', 'I1011', 'I1012',
		'pickaxe', 'bomb', 'centerFly', 'icePickaxe', 'freezeBadge',
		'earthquake', 'upFly', 'downFly', 'jumpShoes', 'lifeWand',
		'superWine',
		'sword1', 'sword2', 'sword3', 'sword4', 'sword5',
		'shield1', 'shield2', 'shield3', 'shield4', 'shield5',
		// 在这里可以增加新的ID来进行统计个数，只能增加道具ID
	];
},
        "drawAbout": function () {
	// 绘制“关于”界面
	core.ui.closePanel();
	core.lockControl();
	core.status.event.id = 'about';

	var left = 48,
		top = 36,
		right = core.__PIXELS__ - 2 * left,
		bottom = core.__PIXELS__ - 2 * top;

	core.setAlpha('ui', 0.85);
	core.fillRect('ui', left, top, right, bottom, '#000000');
	core.setAlpha('ui', 1);
	core.strokeRect('ui', left - 1, top - 1, right + 1, bottom + 1, '#FFFFFF', 2);

	var text_start = left + 24;

	// 名称
	core.setTextAlign('ui', 'left');
	var globalAttribute = core.status.globalAttribute || core.initStatus.globalAttribute;
	core.fillText('ui', "HTML5 魔塔样板", text_start, top + 35, globalAttribute.selectColor, "bold 22px " + globalAttribute.font);
	core.fillText('ui', "版本： " + main.__VERSION__, text_start, top + 80, "#FFFFFF", "bold 17px " + globalAttribute.font);
	core.fillText('ui', "作者： 艾之葵", text_start, top + 112);
	core.fillText('ui', 'HTML5魔塔交流群：539113091', text_start, top + 112 + 32);
	// TODO: 写自己的“关于”页面，每次增加32像素即可
	core.playSound('打开界面');
}
    }
}
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
	var globals = ["__itemHint__", "autoGetItem", "autoGetGreenKey", "autoBattle", "itemDetail"];
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

	// 获得金币
	var money = guards.reduce(function (curr, g) {
		return curr + core.material.enemys[g[2]].money;
	}, core.getEnemyValue(enemy, "money", x, y));
	if (core.hasItem('coin')) money *= 2; // 幸运金币：双倍
	if (core.hasFlag('curse')) money = 0; // 诅咒效果
	if (core.hasItem('I658')) money *= core.itemCount("I658") + 1; // 禀赋
	core.status.hero.money += Math.ceil(money);
	core.status.hero.statistics.money += money;

	// 获得经验
	var exp = guards.reduce(function (curr, g) {
		return curr + core.material.enemys[g[2]].exp;
	}, core.getEnemyValue(enemy, "exp", x, y));
	if (core.hasFlag('curse')) exp = 0;
	core.status.hero.exp += exp;
	core.status.hero.statistics.exp += exp;

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
	if ((itemId.endsWith('Potion') || itemId == "poisonWine" || itemId == "weakWine" || itemId == "I572" || itemId == "curseWine" || itemId == "I619" || itemId == "I620" || itemId == "I621" || itemId == "I622" || itemId == "I1009" || itemId == "I1010" || itemId == "I1011" || itemId == "I1012") && core.material.items[itemId].cls == 'items') {
		core.playSound('回血');
		core.drawHeroAnimate("xue");
	} else if ((itemId.endsWith('Gem') || itemId == "I576" || itemId == "I577" || itemId == "I578" || itemId == "I579" || itemId == "I584" || itemId == "I585" || itemId == "I586" || itemId == "I587" || itemId == "I635" || itemId == "I636" || itemId == "I637" || itemId == "I638" || itemId == "I639" || itemId == "I640" || itemId == "I641" || itemId == "I642" || itemId == "I643" || itemId == "I644" || itemId == "I645" || itemId == "I646" || itemId == "I1013" || itemId == "I1014" || itemId == "I1015" || itemId == "I1016" || itemId == "I1017" || itemId == "I1018" || itemId == "I1019" || itemId == "I1020" || itemId == "I1021" || itemId == "I1022" || itemId == "I1023" || itemId == "I1024") && core.material.items[itemId].cls == 'items') {
		core.playSound('宝石');
		if (itemId == "I576" || itemId == "I584" || itemId == "I635" || itemId == "I639" || itemId == "I643" || itemId == "I1013" || itemId == "I1017" || itemId == "I1021" || itemId == "redGem")
			core.drawHeroAnimate("red");
		else if (itemId == "I577" || itemId == "I585" || itemId == "I636" || itemId == "I640" || itemId == "I644" || itemId == "I1014" || itemId == "I1018" || itemId == "I1022" || itemId == "blueGem")
			core.drawHeroAnimate("blue");
		else if (itemId == "I579" || itemId == "I587" || itemId == "I638" || itemId == "I642" || itemId == "I646" || itemId == "I1016" || itemId == "I1020" || itemId == "I1024" || itemId == "yellowGem")
			core.drawHeroAnimate("yellow");
		else if (itemId == "I578" || itemId == "I586" || itemId == "I637" || itemId == "I641" || itemId == "I645" || itemId == "I1015" || itemId == "I1019" || itemId == "I1023" || itemId == "greenGem")
			core.drawHeroAnimate("green");

	} else
		core.playSound('获得道具');

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
		[1, "迅捷", "这个敌人出手很快。\n敌人首先攻击。", "#ffcc33"],
		[2, "魔攻", "这个敌人似乎掌握了魔法。\n敌人无视角色的防御。", "#bbb0ff"],
		[3, "坚固", "这个敌人拥有石元素之力，坚不可摧。\n敌人防御不小于角色攻击-1。", "#c0b088"],
		[4, "2连击", "敌人进攻速度很快，拥有更加恐怖的杀伤力，但同时也意味着生命力会较为脆弱。\n敌人每回合攻击2次。", "#ffee77"],
		[5, "3连击", "敌人进攻速度很快，拥有更加恐怖的杀伤力，但同时也意味着生命力会较为脆弱。\n敌人每回合攻击3次。", "#ffee77"],
		[6, function (enemy) { return (enemy.n || '') + "连击"; }, function (enemy) { return "敌人进攻速度很快，拥有更加恐怖的杀伤力，但同时也意味着生命力会较为脆弱。\n敌人每回合攻击" + (enemy.n || 4) + "次。"; }, "#ffee77"],
		[7, "破甲", function (enemy) { return "战斗前，敌人附加角色防御的" + Math.floor(100 * (enemy.defValue || core.values.breakArmor || 0)) + "%作为伤害"; }, "#b30000"],
		[8, "反击", function (enemy) { return "战斗时，敌人每回合附加角色攻击的" + Math.floor(100 * (enemy.atkValue || core.values.counterAttack || 0)) + "%作为伤害，无视角色防御"; }, "#ffaa44"],
		[9, "净化", function (enemy) { return "战斗前，敌人附加角色护盾的" + (enemy.n || core.values.purify) + "倍作为伤害。"; }, "#80eed6"],
		[10, "模仿", "敌人的攻防和角色攻防相等", "#b0c0dd"],
		[11, "吸血", function (enemy) { return "战斗前，敌人首先吸取角色的" + Math.floor(100 * enemy.value || 0) + "%生命（约" + Math.floor((enemy.value || 0) * core.getStatus('hp')) + "点）作为伤害" + (enemy.add ? "，并把伤害数值加到自身生命上" : ""); }, "#ff00d2"],
		[12, "中毒", "战斗后，角色陷入中毒状态，每一步损失生命" + core.values.poisonDamage + "点", "#99ee88"],
		[13, "衰弱", "战斗后，角色陷入衰弱状态，攻防暂时下降" + (core.values.weakValue >= 1 ? core.values.weakValue + "点" : parseInt(core.values.weakValue * 100) + "%"), "#f0bbcc"],
		[14, "诅咒", "战斗后，角色陷入诅咒状态，战斗无法获得金币和经验", "#bbeef0"],
		[15, "领域", function (enemy) { return "经过敌人周围" + (enemy.zoneSquare ? "九宫格" : "十字") + "范围内" + (enemy.range || 1) + "格时自动减生命" + (enemy.value || 0) + "点"; }, "#c677dd"],
		[16, "夹击", "经过两只相同的敌人中间，角色生命值变成一半，该技能效果不会超过怪物伤害。", "#bb99ee"],
		[17, "仇恨", "战斗前，敌人附加之前积累的仇恨值作为伤害；战斗后，释放一半的仇恨值。（每杀死一个敌人获得" + (core.values.hatred || 0) + "点仇恨值）", "#b0b666"],
		[18, "阻击", function (enemy) { return "这个敌人似乎懂得且战且退的道理。\n经过敌人的" + (enemy.zoneSquare ? "九宫格" : "十字") + "领域时自动减生命" + (enemy.zuji || 0) + "点，同时敌人后退一格。"; }, "#8888e6"],
		[19, "自爆", "战斗后角色的生命值变成1", "#ff6666"],
		[20, "无敌", "角色无法打败敌人，除非拥有十字架", "#aaaaaa"],
		[21, "退化", function (enemy) { return "战斗后角色永久下降" + (enemy.atkValue || 0) + "点攻击和" + (enemy.defValue || 0) + "点防御"; }],
		[22, "灵体", function (enemy) { return "敌人对角色造成" + (enemy.damage || 0) + "点固定伤害，该伤害可被护盾减免，减免效果为护盾的9倍；当角色护盾达到该伤害的1/10时，灵体失效。"; }, "#ff9977"],
		[23, "不灭", "这个家伙不会死掉的吗？可惜没有办法刷经验……\n敌人被击败后，角色转换楼层则敌人将再次出现", "#a0e0ff"],
		[24, "激光", function (enemy) { return "经过敌人同行或同列时自动减生命" + (enemy.value || 0) + "点"; }, "#dda0dd"],
		[25, "光环", function (enemy) { return "光环异兽的身周总是围着一群异兽，并且个个都看起来很亢奋。" + (enemy.zoneSquare ? "\n自身九宫格范围内敌人生命提升" : "\n同楼层所有敌人生命提升") + (enemy.value || 0) + "%，攻击提升" + (enemy.atkValue || 0) + "%，防御提升" + (enemy.defValue || 0) + "%，" + (enemy.add ? "可叠加。" : "不可叠加。"); }, "#e6e099", 1],
		[26, "支援", "当周围一圈的敌人受到攻击时将上前支援，并组成小队战斗。", "#77c0b6", 1],
		[27, "捕捉", "当走到敌人周围十字时会强制进行战斗", "#c0ddbb"],
		[29, "回风", "借助风元素的势进行的二段不对等打击。\n敌人每回合以0.8、1.2倍攻击各攻击一次。", "#8ed1a6"],
		[30, "反转", "微妙的塔道领悟，令战斗方式产生诡异的变化。\n战斗中，角色攻击与防御效力交换。", "#FFC0CB"],
		[32, "分裂", "拥有两种能力的战斗法师。\n敌人每回合额外造成1倍攻击力的魔法伤害，且当角色防御超过防杀临界时，多余的防御将正常减免该伤害。", "#8ea5d1"],
		[33, "牵制", "牵制对手的招式可能成为窍门或是负累。\n敌人每回合伤害*（敌人防御力/角色防御力）。", "#25c1d9"],
		[34, "散华", "奇妙的能力，感应血气并作用于攻击。\n角色攻击的效力削弱（敌人生命/角色生命）的十分之一。", "#d68e53"],
		[35, "灵闪", "光元素领悟，以快而强大的进攻压制对手。\n当角色的攻击（计算加成）少于敌人时，敌人受到的伤害比例减少（敌人防御/角色防御）的二分之一。", "#f2ec41"],
		[36, "异界之门", "触及了一丝命运规律的领悟，张开的黑暗之门似通向另一个世界。\n敌人的战斗回合数平方化。", "#808080"],
		[37, "疾走", "这个敌人出手快得惊人。\n敌人首先发动一次3连击。", "#5dc44b"],
		[38, "饮剑", "将炽烈的进攻元素吸收并化为自身的能力。\n敌人的生命增加角色攻击的5倍。", "#f0a078"],
		[39, "同调", "玄妙且具备威胁的领悟，可以共享属性。\n敌人会随着角色的变强而变强，其攻防附加10%角色的攻防。"],
		[40, "衰弱", "用毒魔法弱化对手的能力。\n与该敌人战斗时，角色的攻防效力削弱10%。", "#f2a4e8"],
		[41, "撕裂", "这个敌人攻击非常凶猛，造成了撕裂效果。\n敌人的战斗伤害增加一半。", "#A52A2A"],
		[42, "斩阵", "看起来很像虚张声势的剑阵。\n敌人布下诡秘的杀阵，在战斗进行到第五、十、十五回合时，分别对角色造成1倍、2倍、4倍敌人攻击力的穿透伤害。", "#5279B7"],
		[43, "天剑", "可将天地能量汇聚于自身的攻势进行战斗。\n敌人每回合额外造成自身攻击3倍与角色防御2倍差值的伤害。", "#9B8AFC"],
		[44, "时封", "封锁这片区域时间的流向。\n战斗伤害增加（回合数+1）倍。", "#917881"],
		[45, "绝世", "五连绝世。\n战斗前，敌人以0.9倍的攻击力发动一次5连击。", "#DCF27B"],
		[46, "惑幻", "制人于幻境中，受到幻境的蛊惑。\n战斗前，角色自残3回合。", "#B20EB2"],
		[47, "凌弱", "欺凌弱小的敌人容易被防杀。\n当角色防御小于敌人时，其与敌人防御的差值将拉大一倍。", "#109996"],
		[48, "反戈", "反戈一击。\n敌人将角色伤害的20%反弹给角色。", "#D3A547"],
		[49, "柔骨", "接下攻击，并化为另一种劲力发回。\n战斗时，角色的攻击效力转移10%到防御上。", "#2CBA3A"],
		[50, "饮盾", "将刚猛的防守元素吸收并化为自身的能力。\n敌人的生命增加角色防御的5倍。", "#3C6794"],
		[51, "回春", "修习了战复魔法的冒险者钟爱的属性。\n敌人每回合恢复自身战前生命值3%的生命，且恢复的总回合数不超过原本的回合数。", "#CCFF99"],
		[52, "冰符咒", "由传说中的最强妖精创造的符咒，虽然她的生命力并不如何高。\n在第99回合施展冰符咒，额外造成20倍攻击力的魔法伤害。", "#6699FF"],
		[53, "折影剑", "将自身与对手的能量波动，化为数道剑影重叠在剑上。\n敌人的攻击力增加角色的攻防之和。", "#CCCCFF"],
		[54, "禁制", "修习了战复魔法的冒险者厌恶的属性。\n敌人的伤害不小于0。", "#727C87"],
		[55, "恶魔烧酒", "你在看什么啊，走开变态！尤其是你，神哥！不许看！\n以两倍攻击力进攻，无视对手防御，并附带相当于对手五分之一攻防和的水魔法伤害。\n面对高于自己三个以上境界的对手，额外追加一倍攻击力，水魔法伤害翻倍，并削弱对手96%的攻击力。", "#e075db"],
		[56, "袭杀者", "真正的刺客，是会假扮成法师的外貌的。\n抢下先手并发动一次流血突刺，削弱对手30%攻防，并造成40万点固定伤害。", "#bf5722"],
		[57, "血火囚牢", "无情的生机掠夺者。\n战斗前造成对方生命10%的真实伤害，并构建囚牢，封住对方350回合的行动。", "#DC143C"],
		[58, "长夜无光", "那个人终会迷失在妄自撕裂自身血肉的幻觉里。\n使对方陷入仿若真实的幻境，混乱30回合，并打上血之烙印，受到的伤害加倍。", "#2F4F4F"],
		[59, "匙弱·黄", "这个敌人似乎对黄钥匙十分敏感。\n角色每拥有1把黄钥匙，该敌人伤害减少3%。", "#dfe650"],
		[60, "无力·破", "这个敌人非常惧怕强大的破墙镐。\n角色每拥有一把破墙镐，该敌人生命减少5%。", "#89f562"],
		[61, "飓风", "这个敌人迅疾如风，引动了天地间的风元素异象。\n敌人首先发动一次20连击。", "#377d3d"],
		[62, "自爆", "强者在绝望之下最后的尊严。\n第200回合触发，立即死亡，对角色造成自身剩余生命*4的伤害。", "#597a80"],
		[63, "冰封万里", function (enemy) { return "天地茫茫，纯然一色，包容一切。\n战斗前冻结对手" + (enemy.n || 0) + "回合行动，且每回合对对手造成自身攻击的160%与防御的40%之和的冰冻伤害。该技能效果可被生命减免，每" + (enemy.atkValue || 0) + "点生命可免除1回合冰冻，并减免0.1%伤害。" }, "#6e43f0"],
		[64, "圣阵", "才德全尽谓之圣人，十圆无缺谓之圣阵。\n敌人布下圣阵，在战斗进行到第五十、一百、二百回合时，分别对角色造成3倍、9倍、27倍角色与敌人攻防之和的穿透伤害。", "#d9964a"],
		[65, "执着", "铁杵磨成针。\n敌人每回合额外对角色造成角色生命千分之一的伤害。", "#cbb2d9"],
		[66, "和光同尘", "挫其锐，解其纷，和其光，同其尘。如春风般和煦，夏花般绚烂。\n战斗开始时以周围3*3方形内的事件数量为基准，每有1个事件，则每回合额外回复3000万点生命。", "#82e065"],
		[67, "召唤", "群居生物同心协力的体现。\n战斗结束后，在角色十字范围内的所有空地上召唤【紫锈胎人】（无经验），围困角色。", "#F5DEB3"],
		[68, "匙弱·蓝", "这个敌人似乎对蓝钥匙十分敏感。\n角色每拥有1把蓝钥匙，该敌人伤害减少3%。", "#4f80db"],
		[69, "追光", "这个敌人快得恍若一道照亮世界的光。\n敌人首先发动一次150连击。", "#ecff17"],
		[70, "召唤", "群居生物同心协力的体现。\n战斗结束后，在角色十字范围内的所有空地上召唤【舰船除草机B1】（有经验），围困角色。", "#F5DEB3"],
		[71, "10回合", "在敌人的手中走过十回合！", "#624fdb"],
		[72, "匙弱·黄Ⅱ", "这个敌人似乎对黄钥匙十分敏感。\n角色每拥有1把黄钥匙，该敌人伤害减少2%。", "#dfe650"],
		[73, "匙弱·蓝Ⅱ", "这个敌人似乎对蓝钥匙十分敏感。\n角色每拥有1把蓝钥匙，该敌人伤害减少2%。", "#4f80db"],
		[74, "冰封术", function (enemy) { return "可以让人瞬间变成冰块的术式，唯有蓬勃的生命得以顽强生长。\n战斗前, 冻结角色" + (enemy.n || 0) + "回合行动。该技能效果可被生命减免，每" + (enemy.atkValue || 0) + "点生命可免除1回合冰冻。"; }, "#74e3d4"],
		[75, "冰凌剑", function (enemy) { return "可以将冰元素变换为剑形态，刺穿对手的术式，唯有坚不可摧的护盾方可抵挡。\n战斗前, 对角色造成相当于角色攻防和百倍的固定伤害。该技能效果可被护盾减免，每" + (enemy.atkValue || 0) + "点护盾可减免0.05%伤害。"; }, "#87CEEB"],
		[76, "冻伤", function (enemy) { return "让对手在低温中感受到难以言喻的痛苦，强大的体魄是镇痛的必要条件。\n战斗前, 对角色造成相当于角色护盾百倍的固定伤害。该技能效果可被攻防和减免，每" + (enemy.atkValue || 0) + "点攻防和可减免0.05%伤害。"; }, "#97c6e8"],
		[77, "百线流", "？？？", "#00FA9A"],
		[78, "金空法则", "？？？", "#edec9f"],
		[79, "压制", "压制对手的招式可能成为窍门或是负累。\n敌人每回合伤害*（敌人攻防和/角色攻防和）。", "#e3e647"],
		[80, "生命限制", "限制对手的招式可能成为窍门或是负累。\n敌人每回合伤害*（敌人生命/角色生命）。", "#eb7fb5"],
		[81, "贪婪", "七原罪之一，贪欲永远无法被填满。\n战斗结束后，在【左阿】朝向左右两边及前边的空地上重生，且重生后的怪物将会强化。", "#acd6a0"],
		[82, "匙强·黄", "这个敌人似乎对黄钥匙过敏。\n角色每拥有1把黄钥匙，该敌人伤害增加0.1%，且当匙弱属性降伤达100%时，该属性直接失效。", "#dfe650"],
		[83, "匙强·蓝", "这个敌人似乎对蓝钥匙过敏。\n角色每拥有1把蓝钥匙，该敌人伤害增加0.1%，且当匙弱属性降伤达100%时，该属性直接失效。", "#4f80db"],
		[84, "怠惰", "七原罪之一，怠惰是人类的天性。\n战斗结束后，在角色朝向左右两边及后边的空地上制造一格墙体。", "#FFF8DC"],
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
	// 坚固
	if (core.hasSpecial(mon_special, 3) && mon_def < hero_atk - 1) {
		mon_def = hero_atk - 1;
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
						x != null && y != null && Math.abs(block.x - x) <= 1 && Math.abs(block.y - y) <= 1 && !(x == block.x && y == block.y)) {
						// 记录怪物的x,y，ID
						guards.push([block.x, block.y, id]);
					}

					// TODO：如果有其他类型光环怪物在这里仿照添加检查
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


	// 离火
	var lihuo = 0
	if (core.hasItem("I594")) {
		lihuo += core.itemCount("redKey") * 8;
		if (lihuo > 64) { lihuo = 64; }
		hero_atk *= 1 + (lihuo * 0.003);
	}
	// 离火2
	var lihuo = 0
	if (core.hasItem("I822")) {
		lihuo += core.itemCount("redKey") * 8;
		if (lihuo > 64) { lihuo = 64; }
		hero_atk *= 1 + (lihuo * 0.0036);
	}
	// 离火3
	var lihuo = 0
	if (core.hasItem("I823")) {
		lihuo += core.itemCount("redKey") * 8;
		if (lihuo > 64) { lihuo = 64; }
		hero_atk *= 1 + (lihuo * 0.0042);
	}
	// 离火4
	var lihuo = 0
	if (core.hasItem("I824")) {
		lihuo += core.itemCount("redKey") * 8;
		if (lihuo > 80) { lihuo = 80; }
		hero_atk *= 1 + (lihuo * 0.0042);
	}
	// 离火5
	var lihuo = 0
	if (core.hasItem("I825")) {
		lihuo += core.itemCount("redKey") * 8;
		if (lihuo > 96) { lihuo = 96; }
		hero_atk *= 1 + (lihuo * 0.0042);
	}
	// 离火6
	var lihuo = 0
	if (core.hasItem("I826")) {
		lihuo += core.itemCount("redKey") * 8;
		if (lihuo > 96) { lihuo = 96; }
		hero_atk *= 1 + (lihuo * 0.00495);
	}



	// 坎水
	var kanshui = 0
	if (core.hasItem("I595")) {
		kanshui += core.itemCount("blueKey") * 3;
		if (kanshui > 90) { kanshui = 90; }
		hero_def *= 1 + (kanshui * 0.002);
	}
	// 坎水2
	var kanshui = 0
	if (core.hasItem("I827")) {
		kanshui += core.itemCount("blueKey") * 3;
		if (kanshui > 90) { kanshui = 90; }
		hero_def *= 1 + (kanshui * 0.0024);
	}
	// 坎水3
	var kanshui = 0
	if (core.hasItem("I828")) {
		kanshui += core.itemCount("blueKey") * 3;
		if (kanshui > 90) { kanshui = 90; }
		hero_def *= 1 + (kanshui * 0.0028);
	}
	// 坎水4
	var kanshui = 0
	if (core.hasItem("I829")) {
		kanshui += core.itemCount("blueKey") * 3;
		if (kanshui > 111) { kanshui = 111; }
		hero_def *= 1 + (kanshui * 0.0028);
	}
	// 坎水5
	var kanshui = 0
	if (core.hasItem("I830")) {
		kanshui += core.itemCount("blueKey") * 3;
		if (kanshui > 132) { kanshui = 132; }
		hero_def *= 1 + (kanshui * 0.0028);
	}
	// 坎水6
	var kanshui = 0
	if (core.hasItem("I831")) {
		kanshui += core.itemCount("blueKey") * 3;
		if (kanshui > 132) { kanshui = 132; }
		hero_def *= 1 + (kanshui * 0.0033);
	}


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
		hero_atk *= 0.9;
		hero_def += hero_atk * 0.1;
	}

	// 技能的处理
	if (core.getFlag('skill', 0) == 1) { // 开启了技能1：二倍斩
		hero_atk *= 2; // 计算时攻击力翻倍	
	}

	// 反转
	if (core.hasSpecial(mon_special, 30)) {
		var fanzhuan = hero_def;
		hero_def = hero_atk;
		hero_atk = fanzhuan;
	}

	// 凌弱
	var mond1 = (mon_def - hero_def) * 0.5;
	if (mond1 < 0) mond1 = 0;
	if (core.hasSpecial(mon_special, 47)) {
		hero_def -= mond1;
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

		init_damage += vampire_damage;
	}

	// 永生之花
	if (core.hasItem('I767'))
		mon_hp -= core.getFlag('lasthp') * 0.3;

	// 每回合怪物对勇士造成的战斗伤害
	var per_damage = mon_atk - hero_def;
	// 魔攻：战斗伤害就是怪物攻击力
	if (core.hasSpecial(mon_special, 2)) per_damage = mon_atk;

	// 执着
	if (core.hasSpecial(mon_special, 65)) per_damage += hero_hp * 0.001;
	// 狂乱
	var cha = hero_atk - hero_def;
	if (cha < 0) { fan = 0; }
	if (core.hasSpecial(mon_special, 46)) {
		init_damage += cha * 3;
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
	// 牵制
	if (core.hasSpecial(mon_special, 33))
		per_damage *= (mon_def / hero_def);

	// 压制
	if (core.hasSpecial(mon_special, 79))
		per_damage *= ((mon_atk + mon_def) / (hero_atk + hero_def));

	// 限制
	if (core.hasSpecial(mon_special, 80))
		per_damage *= (mon_hp / hero_hp);

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

	// 勇士的攻击回合数；为怪物生命除以每回合伤害向上取整
	var turn = Math.ceil(mon_hp / hero_per_damage);
	if (turn < 0) { turn = 0; }

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

	// 回春
	if (core.hasSpecial(mon_special, 51)) {
		mon_hp += turn * mon_hp * 0.03;
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
	if (turn >= 99999) turn = 99999;


	// 自爆
	if (core.hasSpecial(mon_special, 62)) {
		if (turn >= 200) {
			turn = 200;
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
	// 再扣去护盾
	damage -= hero_mdef;



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

	// 检查是否允许负伤
	if (!core.flags.enableNegativeDamage)
		damage = Math.max(0, damage);

	// 撕裂
	if (core.hasSpecial(mon_special, 41)) damage = Math.floor(1.5 * damage);



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

	if (core.hasSpecial(mon_special, 56)) { // 刺客
		damage += 400000;
	}



	// E
	if (core.hasItem('I581')) {
		damage *= 0.5;
	}

	// H
	if (core.hasItem('I582')) {
		damage *= 0.9;
	}

	// 兽神
	if (core.hasEquip('I893')) {
		damage *= 0.6;
	}
	if (core.hasEquip('I896')) {
		damage *= 0.6;
	}
	if (core.hasEquip('I897')) {
		damage *= 0.6;
	}
	if (core.hasEquip('I899')) {
		damage *= 0.6;
	}
	if (core.hasEquip('I920')) {
		damage *= 0.6;
	}
	if (core.hasEquip('I921')) {
		damage *= 0.6;
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
		if (core.hasItem('skill1')) {
			core.status.route.push("key:70");
			core.useItem('skill1', true);
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
			core.setFont(ctx, 'bold 14px Verdana');
		else core.setFont(ctx, 'italic bold 14px Verdana');
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
		core.drawLine(ctx, 1, 122, 129, 122, "#FFFFFF", 1);
		core.drawLine(ctx, 1, 147, 129, 147, "#FFFFFF", 1);
		core.drawLine(ctx, 1, 172, 129, 172, "#FFFFFF", 1);
		core.drawLine(ctx, 1, 197, 129, 197, "#FFFFFF", 1);
		core.drawLine(ctx, 1, 222, 129, 222, "#FFFFFF", 1);
		core.drawLine(ctx, 23, 222, 23, 299, "#FFFFFF", 1);
		core.drawLine(ctx, 1, 299, 129, 299, "#FFFFFF", 1);

		if (core.hasItem('I582')) { core.drawImage(ctx, 'E.png', 34, 365, 60, 60); } else { core.drawImage(ctx, 'C.png', 34, 365, 60, 60); }
		//if (core.hasItem('I581')) { core.drawImage(ctx, 'E.png', 29, 368, 60, 60); } else if (core.hasItem('I471')) { core.drawImage(ctx, 'E.png', 29, 368, 60, 60); } else if (core.hasItem('I955')) { core.drawImage(ctx, '5.png', 12, 370, 100, 50); } else if (core.hasItem('I954')) { core.drawImage(ctx, '4.png', 12, 370, 100, 50); } else if (core.hasItem('I953')) { core.drawImage(ctx, '3.png', 12, 370, 100, 50); } else if (core.hasItem('I952')) { core.drawImage(ctx, '2.png', 12, 370, 100, 50); } else { core.drawImage(ctx, '1.png', 12, 370, 100, 50); }

		// 绘制楼层
		//core.drawImage(ctx, core.statusBar.icons.floor, 3, 7, 18, 18);
		_fillBoldTextWithFontCheck((core.status.thisMap || {}).name || "", 64, 20, '#66CCFF');
		core.drawImage(ctx, 'xinglita.jpg', 1.5, 27, 77, 69);
		// 绘制勇士
		//core.drawImage(ctx, 'hero1.png', 3, 33, 16, 24);
		_fillBoldTextWithFontCheck(core.status.hero.name, 103, 42, "#c69ce6");

		// 绘制等级
		//core.drawImage(ctx, core.statusBar.icons.lv, 76, 38, 16, 16);
		//_fillBoldTextWithFontCheck(core.getLvName(), 91, 51, "#FFD800");
		if (core.status.hero.lv <= 9) {
			_fillBoldTextWithFontCheck(core.getLvName(), 64, 115, "#FFFFFF");
		}
		if (core.status.hero.lv >= 10) {
			_fillBoldTextWithFontCheck(core.getLvName(), 64, 115, "#75E97E");
		}
		if (core.status.hero.lv >= 19) {
			_fillBoldTextWithFontCheck(core.getLvName(), 64, 115, "#6FAEE4");
		}
		if (core.status.hero.lv >= 28) {
			_fillBoldTextWithFontCheck(core.getLvName(), 64, 115, "#C76EE7");
		}
		if (core.status.hero.lv >= 37) {
			_fillBoldTextWithFontCheck(core.getLvName(), 64, 115, "#6FAEE4");
		}
		if (core.status.hero.lv >= 46) {
			_fillBoldTextWithFontCheck(core.getLvName(), 64, 115, "#357BCC");
		}
		if (core.status.hero.lv >= 261) {
			_fillBoldTextWithFontCheck(core.getLvName(), 64, 115, "#C76EE7");
		}
		if (core.status.hero.lv >= 301) {
			_fillBoldTextWithFontCheck(core.getLvName(), 64, 115, "#B02FDF");
		}
		if (core.status.hero.lv >= 351) {
			_fillBoldTextWithFontCheck(core.getLvName(), 64, 115, "#E06BBB");
		}
		if (core.status.hero.lv >= 411) {
			_fillBoldTextWithFontCheck(core.getLvName(), 64, 115, "#D930A3");
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



		// 绘制生命
		//core.drawImage(ctx, core.statusBar.icons.hp, 15, 64, 20, 20);
		core.drawImage(ctx, 'hp.png', 15, 125, 20, 20);
		_fillBoldTextWithFontCheck(core.formatBigNumber(core.getRealStatus('hp')), 78, 140, "#d64fdb");

		// 绘制攻击
		//core.drawImage(ctx, core.statusBar.icons.atk, 3, 94, 16, 16);
		core.drawImage(ctx, 'a.png', 15, 150, 20, 20);
		_fillBoldTextWithFontCheck(core.formatBigNumber(core.getRealStatus('atk')), 78, 165, "#e65353");

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

		_fillBoldTextWithFontCheck(('Gold'), 102, 67, '#9ce0d8');
		//_fillBoldTextWithFontCheck(core.formatBigNumber(core.getRealStatus('def')), 102, 92, "#5370e6");

		// 绘制经验
		//core.drawImage(ctx, core.statusBar.icons.up, 68, 143, 16, 16);
		//if (core.getRealStatus('lv') <= 999) { _fillBoldTextWithFontCheck(core.formatBigNumber(core.firstData.levelUp[core.status.hero.lv].need - core.status.hero.exp), 102, 92, "#f2b1e9"); } else { _fillBoldTextWithFontCheck(('∞'), 102, 92, "#f2b1e9"); }
		_fillBoldTextWithFontCheck(core.formatBigNumber(core.status.hero.money), 102, 92, "#FFD700");
		// 绘制四色钥匙
		_fillBoldTextWithFontCheck(('道'), 11, 242, '#9ce0d8');
		_fillBoldTextWithFontCheck(('具'), 11, 266, '#9ce0d8');
		_fillBoldTextWithFontCheck(('栏'), 11, 290, '#9ce0d8');
		core.drawImage(ctx, 'y.png', 26, 230, 16, 16);
		_fillBoldTextWithFontCheck(core.itemCount('yellowKey'), 48, 243, '#FFCCAA');
		core.drawImage(ctx, 'b.png', 60, 230, 16, 16);
		_fillBoldTextWithFontCheck(core.itemCount('blueKey'), 82, 243, '#AAAADD');
		core.drawImage(ctx, 'r.png', 94, 230, 16, 16);
		_fillBoldTextWithFontCheck(core.itemCount('redKey'), 116, 243, '#FF8888');
		core.drawImage(ctx, 'p.png', 38, 255, 16, 16);
		_fillBoldTextWithFontCheck(core.itemCount('pickaxe'), 62, 268, '#808080');
		core.drawImage(ctx, 'z.png', 79, 255, 16, 16);
		_fillBoldTextWithFontCheck(core.itemCount('bomb'), 103, 268, '#CD5C5C');
		core.drawImage(ctx, 'f.png', 38, 280, 16, 16);
		_fillBoldTextWithFontCheck(core.itemCount('centerFly'), 62, 293, '#F4A460');
		core.drawImage(ctx, "lv.png", 79, 280, 16, 16);
		_fillBoldTextWithFontCheck(core.itemCount("greenKey"), 103, 293, 'LightGreen');



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
		core.drawImage(ctx, 'xinglita.jpg', 0, 0, 123, 107);

		// 绘制难度
		if (core.hasItem('I582')) { core.drawImage(ctx, 'E.png', 128, 88, 56, 56); } else { core.drawImage(ctx, 'C.png', 128, 88, 56, 56); }
		// 
		//if (core.hasItem('I474')) { core.drawImage(ctx, 'E.png', 128, 92, 56, 56); } else if (core.hasItem('I471')) { core.drawImage(ctx, 'E.png', 128, 92, 56, 56); } else if (core.hasItem('I955')) { core.drawImage(ctx, '5.png', 116, 99, 80, 40); } else if (core.hasItem('I954')) { core.drawImage(ctx, '4.png', 116, 99, 80, 40); } else if (core.hasItem('I953')) { core.drawImage(ctx, '3.png', 116, 99, 80, 40); } else if (core.hasItem('I952')) { core.drawImage(ctx, '2.png', 116, 99, 80, 40); } else { core.drawImage(ctx, '1.png', 116, 99, 80, 40); }

		// 绘制勇士
		_fillBoldTextWithFontCheck(core.status.hero.name, 158, 30, "#c69ce6");
		_fillBoldTextWithFontCheck(('Gold'), 157, 60, '#9ce0d8');

		// 绘制等级
		//core.drawImage(ctx, core.statusBar.icons.lv, 220, 11, 16, 16);
		//_fillBoldTextWithFontCheck(core.getLvName(), 240, 24, "#FFD800");
		if (core.status.hero.lv <= 9) {
			_fillBoldTextWithFontCheck(core.getLvName(), 63, 128, "#FFFFFF");
		}
		if (core.status.hero.lv >= 10) {
			_fillBoldTextWithFontCheck(core.getLvName(), 63, 128, "#75E97E");
		}
		if (core.status.hero.lv >= 19) {
			_fillBoldTextWithFontCheck(core.getLvName(), 63, 128, "#6FAEE4");
		}
		if (core.status.hero.lv >= 28) {
			_fillBoldTextWithFontCheck(core.getLvName(), 63, 128, "#C76EE7");
		}
		if (core.status.hero.lv >= 37) {
			_fillBoldTextWithFontCheck(core.getLvName(), 63, 128, "#6FAEE4");
		}
		if (core.status.hero.lv >= 46) {
			_fillBoldTextWithFontCheck(core.getLvName(), 63, 128, "#357BCC");
		}
		if (core.status.hero.lv >= 261) {
			_fillBoldTextWithFontCheck(core.getLvName(), 63, 128, "#C76EE7");
		}
		if (core.status.hero.lv >= 301) {
			_fillBoldTextWithFontCheck(core.getLvName(), 63, 128, "#B02FDF");
		}
		if (core.status.hero.lv >= 351) {
			_fillBoldTextWithFontCheck(core.getLvName(), 63, 128, "#E06BBB");
		}
		if (core.status.hero.lv >= 411) {
			_fillBoldTextWithFontCheck(core.getLvName(), 63, 128, "#D930A3");
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
		_fillBoldTextWithFontCheck(core.formatBigNumber(core.status.hero.money), 158, 90, "#FFD700");

		// 绘制经验
		//core.drawImage(ctx, core.statusBar.icons.up, 6, 87, 16, 16);
		//if (core.getRealStatus('lv') <= 999) { _fillBoldTextWithFontCheck(core.formatBigNumber(core.firstData.levelUp[core.status.hero.lv].need - core.status.hero.exp), 158, 90, "#f2b1e9"); } else { _fillBoldTextWithFontCheck(('∞'), 158, 90, "#f2b1e9"); }

		// 绘制四色钥匙
		_fillBoldTextWithFontCheck(('道 具 栏'), 357, 29, '#9ce0d8');
		core.drawImage(ctx, 'y.png', 303, 49, 16, 16);
		_fillBoldTextWithFontCheck(core.itemCount('yellowKey'), 328, 63, '#FFCCAA');
		core.drawImage(ctx, 'b.png', 340, 49, 16, 16);
		_fillBoldTextWithFontCheck(core.itemCount('blueKey'), 365, 63, '#AAAADD');
		core.drawImage(ctx, 'r.png', 377, 49, 16, 16);
		_fillBoldTextWithFontCheck(core.itemCount('redKey'), 402, 63, '#FF8888');
		core.drawImage(ctx, 'p.png', 319, 76, 16, 16);
		_fillBoldTextWithFontCheck(core.itemCount('pickaxe'), 344, 90, '#808080');
		core.drawImage(ctx, 'z.png', 361, 76, 16, 16);
		_fillBoldTextWithFontCheck(core.itemCount('bomb'), 386, 90, '#CD5C5C');
		core.drawImage(ctx, 'f.png', 319, 103, 16, 16);
		_fillBoldTextWithFontCheck(core.itemCount('centerFly'), 344, 117, '#F4A460');
		core.drawImage(ctx, 'lv.png', 361, 103, 16, 16);
		_fillBoldTextWithFontCheck(core.itemCount('greenKey'), 386, 117, 'LightGreen');





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
		'redPotion', 'bluePotion', 'yellowPotion', 'greenPotion', 'superPotion', 'poisonWine', 'weakWine', 'I572', 'curseWine', 'I619', 'I620', 'I621', 'I622',
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
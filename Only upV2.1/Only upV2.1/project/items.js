var items_296f5d02_12fd_4166_a7c1_b5e830c9ee3a = 
{
	"yellowKey": {
		"cls": "tools",
		"name": "黄钥匙",
		"text": "即使血海之上的强者，面对能量锁也无可奈何，但这把钥匙不同。\n可以打开一扇黄门。",
		"hideInToolbox": true
	},
	"blueKey": {
		"cls": "tools",
		"name": "蓝钥匙",
		"text": "即使血海之上的强者，面对能量锁也无可奈何，但这把钥匙不同。\n可以打开一扇蓝门。",
		"hideInToolbox": true
	},
	"redKey": {
		"cls": "tools",
		"name": "红钥匙",
		"text": "即使血海之上的强者，面对能量锁也无可奈何，但这把钥匙不同。\n可以打开一扇红门。",
		"hideInToolbox": true
	},
	"redGem": {
		"cls": "items",
		"name": "初始红宝石",
		"text": "红色的晶体，可以强化自己的力量。\n攻击+${core.formatBigNumber(core.values.redGem * core.status.thisMap.ratio)}。",
		"itemEffect": "core.status.hero.atk += core.values.redGem * core.status.thisMap.ratio",
		"itemEffectTip": "，攻击+${core.formatBigNumber(core.values.redGem * core.status.thisMap.ratio)}",
		"useItemEffect": "core.status.hero.atk += core.values.redGem",
		"canUseItemEffect": "true"
	},
	"blueGem": {
		"cls": "items",
		"name": "初始蓝宝石",
		"text": "蓝色的晶体，可以使自己更加灵巧。\n防御+${core.formatBigNumber(core.values.blueGem * core.status.thisMap.ratio)}。",
		"itemEffect": "core.status.hero.def += core.values.blueGem * core.status.thisMap.ratio",
		"itemEffectTip": "，防御+${core.formatBigNumber(core.values.blueGem * core.status.thisMap.ratio)}",
		"useItemEffect": "core.status.hero.def += core.values.blueGem",
		"canUseItemEffect": "true"
	},
	"greenGem": {
		"cls": "items",
		"name": "初始绿宝石",
		"text": "绿色的晶体，可以吸收受到的伤害。\n护盾+${core.formatBigNumber(core.values.greenGem * core.status.thisMap.ratio)}。",
		"itemEffect": "core.status.hero.mdef += core.values.greenGem * core.status.thisMap.ratio",
		"itemEffectTip": "，护盾+${core.formatBigNumber(core.values.greenGem * core.status.thisMap.ratio)}",
		"useItemEffect": "core.status.hero.mdef += core.values.greenGem",
		"canUseItemEffect": "true"
	},
	"yellowGem": {
		"cls": "items",
		"name": "初始黄宝石",
		"text": "黄色的晶体，似乎非常稀有，蕴含不可思议的能量。\n角色的攻击、防御、护盾同时增加1颗宝石的数值，同时获得相当于黄色血瓶的血量。",
		"itemEffect": "core.status.hero.atk += core.values.redGem * core.status.thisMap.ratio;\ncore.status.hero.def += core.values.blueGem * core.status.thisMap.ratio;\ncore.status.hero.mdef += core.values.greenGem * core.status.thisMap.ratio;\ncore.status.hero.hp += core.values.yellowPotion * core.status.thisMap.ratio;",
		"itemEffectTip": "，全属性提升",
		"useItemEvent": null,
		"canUseItemEffect": "true"
	},
	"redPotion": {
		"cls": "items",
		"name": "红色补给品",
		"text": "飘散在空气中的活泼能量的具现化，能够恢复生命。\n生命+${core.formatBigNumber(core.values.redPotion)}。",
		"itemEffect": "core.status.hero.hp += core.values.redPotion * core.status.thisMap.ratio",
		"itemEffectTip": "，生命+${core.formatBigNumber(core.values.redPotion * core.status.thisMap.ratio)}",
		"useItemEffect": "core.status.hero.hp += core.values.redPotion",
		"canUseItemEffect": "true"
	},
	"bluePotion": {
		"cls": "items",
		"name": "蓝色补给品",
		"text": "飘散在空气中的活泼能量的具现化，能够恢复生命。\n生命+${core.formatBigNumber(core.values.bluePotion)}。",
		"itemEffect": "core.status.hero.hp += core.values.bluePotion * core.status.thisMap.ratio",
		"itemEffectTip": "，生命+${core.formatBigNumber(core.values.bluePotion * core.status.thisMap.ratio)}",
		"useItemEffect": "core.status.hero.hp += core.values.bluePotion",
		"canUseItemEffect": "true"
	},
	"yellowPotion": {
		"cls": "items",
		"name": "黄色补给品",
		"text": "飘散在空气中的活泼能量的具现化，能够恢复生命。\n生命+${core.formatBigNumber(core.values.yellowPotion)}。",
		"itemEffect": "core.status.hero.hp += core.values.yellowPotion * core.status.thisMap.ratio",
		"itemEffectTip": "，生命+${core.formatBigNumber(core.values.yellowPotion * core.status.thisMap.ratio)}",
		"useItemEffect": "core.status.hero.hp += core.values.yellowPotion",
		"canUseItemEffect": "true"
	},
	"greenPotion": {
		"cls": "items",
		"name": "绿色补给品",
		"text": "飘散在空气中的活泼能量的具现化，能够恢复生命。\n生命+${core.formatBigNumber(core.values.greenPotion)}。",
		"itemEffect": "core.status.hero.hp += core.values.greenPotion * core.status.thisMap.ratio",
		"itemEffectTip": "，生命+${core.formatBigNumber(core.values.greenPotion * core.status.thisMap.ratio)}",
		"useItemEffect": "core.status.hero.hp += core.values.greenPotion",
		"canUseItemEffect": "true"
	},
	"sword0": {
		"cls": "items",
		"name": "破旧的剑",
		"text": "一把已经生锈的剑",
		"equip": {
			"type": 0,
			"animate": "sword",
			"value": {
				"atk": 0
			}
		},
		"itemEffect": "core.status.hero.atk += 0",
		"itemEffectTip": "，攻击+0"
	},
	"sword1": {
		"cls": "items",
		"name": "蜜罐",
		"text": "巨熊们守卫着的蜜罐，里面装的是？……普通的蜂蜜吗？\n生命+2亿，攻击、防御+5%。",
		"equip": {
			"type": 0,
			"animate": "sword",
			"value": {
				"atk": 10
			}
		},
		"itemEffect": "core.status.hero.atk *= 1.05;\ncore.status.hero.def *= 1.05;\ncore.status.hero.hp += 200000000;",
		"itemEffectTip": "，生命+2亿，攻击、防御+5%。"
	},
	"sword2": {
		"cls": "items",
		"name": "空能蜂巢",
		"text": "似乎是红海原力催动的灵器，虽然里面没有蜜蜂但还是可以产出价值不菲的蜂蜜。\n攻击、防御+8万。",
		"equip": {
			"type": 0,
			"animate": "sword",
			"value": {
				"atk": 20
			}
		},
		"itemEffect": "core.status.hero.atk += 80000;\ncore.status.hero.def += 80000;",
		"itemEffectTip": "，攻击、防御+8万。"
	},
	"sword3": {
		"cls": "items",
		"name": "骑士剑",
		"text": "一把很普通的骑士剑",
		"equip": {
			"type": 0,
			"animate": "sword",
			"value": {
				"atk": 40
			},
			"percentage": {}
		},
		"itemEffect": "core.status.hero.atk += 40",
		"itemEffectTip": "，攻击+40"
	},
	"sword4": {
		"cls": "items",
		"name": "圣剑",
		"text": "一把很普通的圣剑",
		"equip": {
			"type": 0,
			"animate": "sword",
			"value": {
				"atk": 80
			}
		},
		"itemEffect": "core.status.hero.atk += 80",
		"itemEffectTip": "，攻击+80"
	},
	"sword5": {
		"cls": "items",
		"name": "神圣剑",
		"text": "一把很普通的神圣剑",
		"equip": {
			"type": 0,
			"animate": "sword",
			"value": {
				"atk": 160
			}
		},
		"itemEffect": "core.status.hero.atk += 100",
		"itemEffectTip": "，攻击+100"
	},
	"shield0": {
		"cls": "items",
		"name": "破旧的盾",
		"text": "一个很破旧的铁盾",
		"equip": {
			"type": 1,
			"value": {
				"def": 0
			}
		},
		"itemEffect": "core.status.hero.def += 0",
		"itemEffectTip": "，防御+0"
	},
	"shield1": {
		"cls": "items",
		"name": "铁盾",
		"text": "一个很普通的铁盾",
		"equip": {
			"type": 1,
			"value": {
				"def": 10
			}
		},
		"itemEffect": "core.status.hero.def += 10",
		"itemEffectTip": "，防御+10"
	},
	"shield2": {
		"cls": "items",
		"name": "银盾",
		"text": "一个很普通的银盾",
		"equip": {
			"type": 1,
			"value": {
				"def": 20
			}
		},
		"itemEffect": "core.status.hero.def += 20",
		"itemEffectTip": "，防御+20"
	},
	"shield3": {
		"cls": "items",
		"name": "骑士盾",
		"text": "一个很普通的骑士盾",
		"equip": {
			"type": 1,
			"value": {
				"def": 40
			}
		},
		"itemEffect": "core.status.hero.def += 40",
		"itemEffectTip": "，防御+40"
	},
	"shield4": {
		"cls": "items",
		"name": "圣盾",
		"text": "一个很普通的圣盾",
		"equip": {
			"type": 1,
			"value": {
				"def": 80
			}
		},
		"itemEffect": "core.status.hero.def += 80",
		"itemEffectTip": "，防御+80"
	},
	"shield5": {
		"cls": "items",
		"name": "神圣盾",
		"text": "一个很普通的神圣盾",
		"equip": {
			"type": 1,
			"value": {
				"def": 100,
				"mdef": 100
			}
		},
		"itemEffect": "core.status.hero.def += 100;core.status.hero.mdef += 100",
		"itemEffectTip": "，防御+100，护盾+100"
	},
	"superPotion": {
		"cls": "tools",
		"name": "圣水",
		"itemEffect": "core.status.hero.hp *= 2",
		"itemEffectTip": "，生命值翻倍",
		"useItemEffect": "core.status.hero.hp *= 2;\ncore.playSound('回血');",
		"canUseItemEffect": "true",
		"text": "永远不会消失的生命之水。\n使角色生命值翻倍。（点击生效）"
	},
	"book": {
		"cls": "constants",
		"name": "意念感知",
		"text": "可以查看当前楼层各对手属性。",
		"hideInToolbox": true,
		"useItemEffect": "core.ui.drawBook(0);",
		"canUseItemEffect": "true"
	},
	"fly": {
		"cls": "constants",
		"name": "楼层传送器",
		"text": "可以自由往来去过的楼层",
		"hideInReplay": true,
		"hideInToolbox": true,
		"useItemEffect": "core.ui.drawFly(core.floorIds.indexOf(core.status.floorId));",
		"canUseItemEffect": "(function () {\n\tif (core.flags.flyNearStair && !core.nearStair()) return false;\n\tif (core.hasEnemyLeft('E1649')) return false;\n\treturn core.status.maps[core.status.floorId].canFlyFrom;\n})();"
	},
	"coin": {
		"cls": "tools",
		"name": "幸运金币",
		"text": "持有时打败对手可得双倍金币"
	},
	"freezeBadge": {
		"cls": "constants",
		"name": "冰冻徽章",
		"text": "可以将面前的熔岩变成平地",
		"useItemEffect": "(function () {\n\tvar success = false;\n\n\tvar snowFourDirections = false; // 是否多方向雪花；如果是将其改成true\n\tif (snowFourDirections) {\n\t\t// 多方向雪花\n\t\tfor (var direction in core.utils.scan) { // 多方向雪花默认四方向，如需改为八方向请将这两个scan改为scan2\n\t\t\tvar delta = core.utils.scan[direction];\n\t\t\tvar nx = core.getHeroLoc('x') + delta.x,\n\t\t\t\tny = core.getHeroLoc('y') + delta.y;\n\t\t\tif (core.getBlockId(nx, ny) == 'lava') {\n\t\t\t\tcore.removeBlock(nx, ny);\n\t\t\t\tsuccess = true;\n\t\t\t}\n\t\t}\n\t} else {\n\t\tif (core.getBlockId(core.nextX(), core.nextY()) == 'lava') {\n\t\t\tcore.removeBlock(core.nextX(), core.nextY());\n\t\t\tsuccess = true;\n\t\t}\n\t}\n\n\tif (success) {\n\t\tcore.playSound('打开界面');\n\t\tcore.drawTip(core.material.items[itemId].name + '使用成功', itemId);\n\t} else {\n\t\tcore.playSound('操作失败');\n\t\tcore.drawTip(\"当前无法使用\" + core.material.items[itemId].name, itemId);\n\t\tcore.addItem(itemId, 1);\n\t\treturn;\n\t}\n})();",
		"canUseItemEffect": "true"
	},
	"cross": {
		"cls": "constants",
		"name": "十字架",
		"text": "持有后无视对手的无敌属性"
	},
	"dagger": {
		"cls": "constants",
		"name": "屠龙匕首",
		"text": "该道具尚未被定义"
	},
	"amulet": {
		"cls": "constants",
		"name": "护符",
		"text": "持有时无视负面地形"
	},
	"bigKey": {
		"cls": "tools",
		"name": "大黄门钥匙",
		"text": "可以开启当前层所有普通黄门。",
		"itemEffect": "core.addItem('yellowKey', 1);\ncore.addItem('blueKey', 1);\ncore.addItem('redKey', 1);",
		"itemEffectTip": "，全钥匙+1",
		"useItemEffect": "(function () {\n\tvar actions = core.searchBlock(\"yellowDoor\").map(function (block) {\n\t\treturn { \"type\": \"openDoor\", \"loc\": [block.x, block.y], \"async\": true };\n\t});\n\tactions.push({ \"type\": \"waitAsync\" });\n\tactions.push({ \"type\": \"tip\", \"text\": core.material.items[itemId].name + \"使用成功\" });\n\tcore.insertAction(actions);\n})();",
		"canUseItemEffect": "(function () {\n\treturn core.searchBlock('yellowDoor').length > 0;\n})();"
	},
	"greenKey": {
		"cls": "tools",
		"name": "绿钥匙",
		"text": "可以打开一扇绿门"
	},
	"steelKey": {
		"cls": "tools",
		"name": "铁门钥匙",
		"text": "可以打开一扇铁门"
	},
	"pickaxe": {
		"cls": "tools",
		"name": "破墙镐",
		"text": "破坏面前的小型障碍物。",
		"useItemEffect": "(function () {\n\tvar canBreak = function (x, y) {\n\t\tvar block = core.getBlock(x, y);\n\t\tif (block == null || block.disable) return false;\n\t\treturn block.event.canBreak;\n\t};\n\n\tvar success = false;\n\tvar pickaxeFourDirections = false; // 是否多方向破；如果是将其改成true\n\tif (pickaxeFourDirections) {\n\t\t// 多方向破\n\t\tfor (var direction in core.utils.scan) { // 多方向破默认四方向，如需改成八方向请将这两个scan改为scan2\n\t\t\tvar delta = core.utils.scan[direction];\n\t\t\tvar nx = core.getHeroLoc('x') + delta.x,\n\t\t\t\tny = core.getHeroLoc('y') + delta.y;\n\t\t\tif (canBreak(nx, ny)) {\n\t\t\t\tcore.removeBlock(nx, ny);\n\t\t\t\tsuccess = true;\n\t\t\t}\n\t\t}\n\t} else {\n\t\t// 仅破当前\n\t\tif (canBreak(core.nextX(), core.nextY())) {\n\t\t\tcore.removeBlock(core.nextX(), core.nextY());\n\t\t\tsuccess = true;\n\t\t}\n\t}\n\n\tif (success) {\n\t\tcore.playSound('破墙镐');\n\t\tcore.drawTip(core.material.items[itemId].name + '使用成功', itemId);\n\t} else {\n\t\t// 无法使用\n\t\tcore.playSound('操作失败');\n\t\tcore.drawTip(\"当前无法使用\" + core.material.items[itemId].name, itemId);\n\t\tcore.addItem(itemId, 1);\n\t\treturn;\n\t}\n})();",
		"canUseItemEffect": "true",
		"useItemEvent": []
	},
	"icePickaxe": {
		"cls": "tools",
		"name": "破冰镐",
		"text": "可以破坏勇士面前的一堵冰墙",
		"useItemEffect": "(function () {\n\tcore.drawTip(core.material.items[itemId].name + '使用成功', itemId);\n\tcore.insertAction({ \"type\": \"openDoor\", \"loc\": [\"core.nextX()\", \"core.nextY()\"] });\n})();",
		"canUseItemEffect": "(function () {\n\treturn core.getBlockId(core.nextX(), core.nextY()) == 'ice';\n})();"
	},
	"bomb": {
		"cls": "tools",
		"name": "炸弹",
		"text": "可以炸掉勇士面前的对手",
		"useItemEffect": "(function () {\n\tvar bombList = []; // 炸掉的对手坐标列表\n\tvar todo = []; // 炸弹后事件\n\tvar money = 0,\n\t\texp = 0; // 炸弹获得的金币和经验\n\n\tvar canBomb = function (x, y) {\n\t\tvar block = core.getBlock(x, y);\n\t\tif (block == null || block.disable || block.event.cls.indexOf('enemy') != 0) return false;\n\t\tvar enemy = core.material.enemys[block.event.id];\n\t\treturn enemy && !enemy.notBomb;\n\t};\n\n\tvar bomb = function (x, y) {\n\t\tif (!canBomb(x, y)) return;\n\t\tbombList.push([x, y]);\n\t\tvar id = core.getBlockId(x, y),\n\t\t\tenemy = core.material.enemys[id];\n\t\tmoney += core.getEnemyValue(enemy, 'money', x, y) || 0;\n\t\texp += core.getEnemyValue(enemy, 'exp', x, y) || 0;\n\t\tcore.push(todo, core.floors[core.status.floorId].afterBattle[x + \",\" + y]);\n\t\tcore.push(todo, enemy.afterBattle);\n\t\tcore.removeBlock(x, y);\n\t}\n\n\t// 如果要多方向可炸，把这里的false改成true\n\tif (false) {\n\t\tvar scan = core.utils.scan; // 多方向炸时默认四方向，如果要改成八方向炸可以改成 core.utils.scan2\n\t\tfor (var direction in scan) {\n\t\t\tvar delta = scan[direction];\n\t\t\tbomb(core.getHeroLoc('x') + delta.x, core.getHeroLoc('y') + delta.y);\n\t\t}\n\t} else {\n\t\t// 仅炸当前\n\t\tbomb(core.nextX(), core.nextY());\n\t}\n\n\tif (bombList.length == 0) {\n\t\tcore.playSound('操作失败');\n\t\tcore.drawTip('当前无法使用' + core.material.items[itemId].name, itemId);\n\t\tcore.addItem(itemId, 1);\n\t\treturn;\n\t}\n\n\tcore.playSound('炸弹');\n\tcore.drawTip(core.material.items[itemId].name + '使用成功', itemId);\n\n\t// 取消这里的注释可以炸弹后获得金币和经验\n\tcore.status.hero.money += money;\n\tcore.status.hero.exp += exp;\n\n\t// 取消这里的注释可以炸弹引发战后事件\n\t// if (todo.length > 0) core.insertAction(todo);\n\n})();",
		"canUseItemEffect": "true"
	},
	"centerFly": {
		"cls": "tools",
		"name": "中心对称飞行器",
		"text": "飞向当前楼层中心对称的位置。",
		"useItemEffect": "core.playSound('centerFly.mp3');\ncore.clearMap('hero');\ncore.setHeroLoc('x', core.bigmap.width - 1 - core.getHeroLoc('x'));\ncore.setHeroLoc('y', core.bigmap.height - 1 - core.getHeroLoc('y'));\ncore.drawHero();\ncore.drawTip(core.material.items[itemId].name + '使用成功');",
		"canUseItemEffect": "(function () {\n\tvar toX = core.bigmap.width - 1 - core.getHeroLoc('x'),\n\t\ttoY = core.bigmap.height - 1 - core.getHeroLoc('y');\n\tvar id = core.getBlockId(toX, toY);\n\treturn id == null;\n})();"
	},
	"upFly": {
		"cls": "tools",
		"name": "上楼器",
		"text": "可以飞往楼上的相同位置",
		"useItemEffect": "(function () {\n\tvar floorId = core.floorIds[core.floorIds.indexOf(core.status.floorId) + 1];\n\tif (core.status.event.id == 'action') {\n\t\tcore.insertAction([\n\t\t\t{ \"type\": \"changeFloor\", \"loc\": [core.getHeroLoc('x'), core.getHeroLoc('y')], \"floorId\": floorId },\n\t\t\t{ \"type\": \"tip\", \"text\": core.material.items[itemId].name + '使用成功' }\n\t\t]);\n\t} else {\n\t\tcore.changeFloor(floorId, null, core.status.hero.loc, null, function () {\n\t\t\tcore.drawTip(core.material.items[itemId].name + '使用成功');\n\t\t\tcore.replay();\n\t\t});\n\t}\n})();",
		"canUseItemEffect": "(function () {\n\tvar floorId = core.status.floorId,\n\t\tindex = core.floorIds.indexOf(floorId);\n\tif (index < core.floorIds.length - 1) {\n\t\tvar toId = core.floorIds[index + 1],\n\t\t\ttoX = core.getHeroLoc('x'),\n\t\t\ttoY = core.getHeroLoc('y');\n\t\tvar mw = core.floors[toId].width,\n\t\t\tmh = core.floors[toId].height;\n\t\tif (toX >= 0 && toX < mw && toY >= 0 && toY < mh && core.getBlock(toX, toY, toId) == null) {\n\t\t\treturn true;\n\t\t}\n\t}\n\treturn false;\n})();"
	},
	"downFly": {
		"cls": "tools",
		"name": "下楼器",
		"text": "可以飞往楼下的相同位置",
		"useItemEffect": "(function () {\n\tvar floorId = core.floorIds[core.floorIds.indexOf(core.status.floorId) - 1];\n\tif (core.status.event.id == 'action') {\n\t\tcore.insertAction([\n\t\t\t{ \"type\": \"changeFloor\", \"loc\": [core.getHeroLoc('x'), core.getHeroLoc('y')], \"floorId\": floorId },\n\t\t\t{ \"type\": \"tip\", \"text\": core.material.items[itemId].name + '使用成功' }\n\t\t]);\n\t} else {\n\t\tcore.changeFloor(floorId, null, core.status.hero.loc, null, function () {\n\t\t\tcore.drawTip(core.material.items[itemId].name + '使用成功');\n\t\t\tcore.replay();\n\t\t});\n\t}\n})();",
		"canUseItemEffect": "(function () {\n\tvar floorId = core.status.floorId,\n\t\tindex = core.floorIds.indexOf(floorId);\n\tif (index > 0) {\n\t\tvar toId = core.floorIds[index - 1],\n\t\t\ttoX = core.getHeroLoc('x'),\n\t\t\ttoY = core.getHeroLoc('y');\n\t\tvar mw = core.floors[toId].width,\n\t\t\tmh = core.floors[toId].height;\n\t\tif (toX >= 0 && toX < mw && toY >= 0 && toY < mh && core.getBlock(toX, toY, toId) == null) {\n\t\t\treturn true;\n\t\t}\n\t}\n\treturn false;\n})();"
	},
	"earthquake": {
		"cls": "tools",
		"name": "地震卷轴",
		"text": "可以破坏当前层的所有墙",
		"useItemEffect": "(function () {\n\tvar indexes = [];\n\tfor (var index in core.status.thisMap.blocks) {\n\t\tvar block = core.status.thisMap.blocks[index];\n\t\tif (!block.disable && block.event.canBreak) {\n\t\t\tindexes.push(index);\n\t\t}\n\t}\n\tcore.removeBlockByIndexes(indexes);\n\tcore.redrawMap();\n\tcore.playSound('炸弹');\n\tcore.drawTip(core.material.items[itemId].name + '使用成功');\n})();",
		"canUseItemEffect": "(function () {\n\treturn core.status.thisMap.blocks.filter(function (block) {\n\t\treturn !block.disable && block.event.canBreak;\n\t}).length > 0;\n})();"
	},
	"poisonWine": {
		"cls": "items",
		"name": "大红补给品",
		"text": "浓郁的活泼能量，能使伤口快速愈合。\n增加相当于16倍红血瓶的生命。",
		"useItemEffect": "core.status.hero.hp += core.values.greenPotion * 2",
		"canUseItemEffect": "true",
		"itemEffect": "core.status.hero.hp += core.values.greenPotion * 2 * core.status.thisMap.ratio",
		"itemEffectTip": "，生命+${core.formatBigNumber(core.values.greenPotion * core.status.thisMap.ratio * 2)}"
	},
	"weakWine": {
		"cls": "items",
		"name": "大蓝补给品",
		"text": "浓郁的活泼能量，能使伤口快速愈合。\n增加相当于16倍蓝血瓶的生命。",
		"useItemEffect": "core.status.hero.hp += core.values.greenPotion * 4",
		"canUseItemEffect": true,
		"itemEffect": "core.status.hero.hp += core.values.greenPotion * 4 * core.status.thisMap.ratio",
		"itemEffectTip": "，生命+${core.formatBigNumber(core.values.greenPotion * core.status.thisMap.ratio * 4)}"
	},
	"curseWine": {
		"cls": "items",
		"name": "大绿补给品",
		"text": "浓郁的活泼能量，能使伤口快速愈合。\n增加相当于16倍绿血瓶的生命。",
		"useItemEffect": "core.status.hero.hp += core.values.greenPotion * 16",
		"canUseItemEffect": null,
		"itemEffect": "core.status.hero.hp += core.values.greenPotion * 16 * core.status.thisMap.ratio",
		"itemEffectTip": "，生命+${core.formatBigNumber(core.values.greenPotion * core.status.thisMap.ratio * 16)}"
	},
	"superWine": {
		"cls": "tools",
		"name": "灵水",
		"text": "能够自己涌动的奇异活泼水源。\n使角色生命值*1.5。（点击生效）",
		"useItemEffect": "core.status.hero.hp *= 1.5;\ncore.setFlag('challenge2', 1);\ncore.playSound('回血');",
		"canUseItemEffect": "true",
		"itemEffect": "core.status.hero.hp *= 1.5;",
		"itemEffectTip": "，生命值增加一半'"
	},
	"hammer": {
		"cls": "tools",
		"name": "圣锤",
		"text": "该道具尚未被定义"
	},
	"lifeWand": {
		"cls": "tools",
		"name": "生命魔杖",
		"text": "可以恢复100点生命值",
		"useItemEvent": [
			{
				"type": "comment",
				"text": "先恢复一个魔杖（因为使用道具必须消耗一个）"
			},
			{
				"type": "function",
				"function": "function(){\ncore.addItem('lifeWand', 1);\n}"
			},
			{
				"type": "playSound",
				"name": "打开界面"
			},
			{
				"type": "input",
				"text": "请输入生命魔杖使用次数：(0-${item:lifeWand})"
			},
			{
				"type": "comment",
				"text": "【接受用户输入】弹窗输入的结果将会保存在“flag:input”中\n如果需要更多帮助，请查阅帮助文档"
			},
			{
				"type": "if",
				"condition": "flag:input<=item:lifeWand",
				"true": [
					{
						"type": "setValue",
						"name": "item:lifeWand",
						"operator": "-=",
						"value": "flag:input"
					},
					{
						"type": "setValue",
						"name": "status:hp",
						"operator": "+=",
						"value": "flag:input*100"
					},
					{
						"type": "playSound",
						"name": "回血"
					},
					"成功使用${flag:input}次生命魔杖，恢复${flag:input*100}点生命。"
				],
				"false": [
					{
						"type": "playSound",
						"name": "操作失败"
					},
					"输入不合法！"
				]
			}
		],
		"canUseItemEffect": "true"
	},
	"jumpShoes": {
		"cls": "tools",
		"name": "跳跃靴",
		"text": "能跳跃到前方两格处",
		"useItemEffect": "core.playSound(\"跳跃\");\ncore.insertAction({ \"type\": \"jumpHero\", \"loc\": [core.nextX(2), core.nextY(2)] });",
		"canUseItemEffect": "(function () {\n\tvar nx = core.nextX(2),\n\t\tny = core.nextY(2);\n\treturn nx >= 0 && nx < core.bigmap.width && ny >= 0 && ny < core.bigmap.height && core.getBlockId(nx, ny) == null;\n})();"
	},
	"skill1": {
		"cls": "constants",
		"name": "技能：二倍斩",
		"text": "可以打开或关闭主动技能二倍斩",
		"hideInReplay": true,
		"useItemEffect": "(function () {\n\tvar skillValue = 1; // 技能的flag:skill值，可用于当前开启技能的判定；对于新技能可以依次改成2，3等等\n\tvar skillNeed = 5; // 技能的需求\n\tvar skillName = '二倍斩'; // 技能的名称\n\n\tif (core.getFlag('skill', 0) != skillValue) { // 判断当前是否已经开了技能\n\t\tif (core.getStatus('mana') >= skillNeed) { // 这里要写当前能否开技能的条件判断，比如魔力值至少要多少\n\t\t\tcore.playSound('打开界面');\n\t\t\tcore.setFlag('skill', skillValue); // 开技能1\n\t\t\tcore.setFlag('skillName', skillName); // 设置技能名\n\t\t} else {\n\t\t\tcore.playSound('操作失败');\n\t\t\tcore.drawTip('魔力不足，无法开启技能');\n\t\t}\n\t} else { // 关闭技能\n\t\tcore.setFlag('skill', 0); // 关闭技能状态\n\t\tcore.setFlag('skillName', '无');\n\t}\n})();",
		"canUseItemEffect": "true"
	},
	"wand": {
		"cls": "items",
		"name": "新物品"
	},
	"pack": {
		"cls": "items",
		"name": "钱袋",
		"itemEffect": "core.status.hero.money += 500",
		"itemEffectTip": "，金币+500"
	},
	"I570": {
		"cls": "items",
		"name": "绿钥匙匣子",
		"canUseItemEffect": null,
		"itemEffect": "core.addItem('greenKey', 10)",
		"itemEffectTip": ",绿钥匙+10",
		"text": "非常绿的匣子，装有10把绿钥匙。"
	},
	"I571": {
		"cls": "items",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I572": {
		"cls": "items",
		"name": "大黄补给品",
		"itemEffect": "core.status.hero.hp += core.values.greenPotion * 8 * core.status.thisMap.ratio",
		"itemEffectTip": "，生命+${core.formatBigNumber(core.values.greenPotion * core.status.thisMap.ratio * 8)}",
		"useItemEffect": "core.status.hero.hp += core.values.greenPotion * 8",
		"text": "浓郁的活泼能量，能使伤口快速愈合。\n增加相当于16倍黄血瓶的生命"
	},
	"I573": {
		"cls": "tools",
		"name": "血点",
		"canUseItemEffect": "true",
		"hideInToolbox": true
	},
	"I574": {
		"cls": "items",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I575": {
		"cls": "items",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I576": {
		"cls": "items",
		"name": "高阶红宝石",
		"itemEffect": "core.status.hero.atk += core.values.redGem * core.status.thisMap.ratio * 2",
		"itemEffectTip": "，攻击+${core.formatBigNumber(core.values.redGem * core.status.thisMap.ratio*2)}",
		"text": "高阶红色晶体，可以更大化强化自己的力量。\n直接增加2倍于普通红宝石的攻击力。"
	},
	"I577": {
		"cls": "items",
		"name": "高阶蓝宝石",
		"itemEffect": "core.status.hero.def += core.values.blueGem * core.status.thisMap.ratio*2",
		"itemEffectTip": "，防御+${core.formatBigNumber(core.values.blueGem * core.status.thisMap.ratio*2)}",
		"text": "高阶蓝色晶体，可以更大化使自己更加灵巧。\n直接增加2倍于普通蓝宝石的防御力。"
	},
	"I578": {
		"cls": "items",
		"name": "高阶绿宝石",
		"itemEffect": "core.status.hero.mdef += core.values.greenGem * core.status.thisMap.ratio*2",
		"itemEffectTip": "，护盾+${core.formatBigNumber(core.values.greenGem * core.status.thisMap.ratio*2)}",
		"text": "高阶绿色晶体，可以更大化吸收受到的伤害。\n直接增加2倍于普通绿宝石的护盾。"
	},
	"I579": {
		"cls": "items",
		"name": "高阶黄宝石",
		"itemEffectTip": "，全属性提升",
		"canUseItemEffect": "true",
		"itemEffect": "core.status.hero.atk += core.values.redGem * core.status.thisMap.ratio * 2;\ncore.status.hero.def += core.values.blueGem * core.status.thisMap.ratio * 2;\ncore.status.hero.mdef += core.values.greenGem * core.status.thisMap.ratio * 2;\ncore.status.hero.hp += core.values.yellowPotion * core.status.thisMap.ratio * 2;",
		"text": "高阶黄色晶体，似乎非常稀有，蕴含不可思议的能量。\n直接增加2倍于普通黄宝石的全属性。"
	},
	"I580": {
		"cls": "items",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I581": {
		"cls": "constants",
		"name": "Rank：Easy",
		"canUseItemEffect": "true",
		"text": "伤害减免36%。"
	},
	"I582": {
		"cls": "constants",
		"name": "Rank：Hard",
		"canUseItemEffect": "true",
		"text": "伤害减免8%。"
	},
	"I583": {
		"cls": "constants",
		"name": "Rank：Chaos",
		"canUseItemEffect": "true",
		"text": "诶，你……选择了这个吗。"
	},
	"I584": {
		"cls": "items",
		"name": "极品红宝石",
		"itemEffect": "core.status.hero.atk += core.values.redGem * core.status.thisMap.ratio * 5",
		"itemEffectTip": "，攻击+${core.formatBigNumber(core.values.redGem * core.status.thisMap.ratio*5)}",
		"text": "极为珍贵的红色晶体，能够使体质产生不小的变化。\n直接增加5倍于普通红宝石的攻击力。"
	},
	"I585": {
		"cls": "items",
		"name": "极品蓝宝石",
		"itemEffect": "core.status.hero.def += core.values.blueGem * core.status.thisMap.ratio*5",
		"itemEffectTip": "，防御+${core.formatBigNumber(core.values.blueGem * core.status.thisMap.ratio*5)}",
		"text": "极为珍贵的蓝色晶体，能够使自身变得轻盈如燕。\n直接增加5倍于普通蓝宝石的防御力。"
	},
	"I586": {
		"cls": "items",
		"name": "极品绿宝石",
		"itemEffect": "core.status.hero.mdef += core.values.greenGem * core.status.thisMap.ratio*5",
		"itemEffectTip": "，护盾+${core.formatBigNumber(core.values.greenGem * core.status.thisMap.ratio*5)}",
		"text": "极为珍贵的绿色晶体，足以吸收致命的伤害。\n直接增加5倍于普通绿宝石的护盾。"
	},
	"I587": {
		"cls": "items",
		"name": "极品黄宝石",
		"itemEffect": "core.status.hero.atk += core.values.redGem * core.status.thisMap.ratio * 5;\ncore.status.hero.def += core.values.blueGem * core.status.thisMap.ratio * 5;\ncore.status.hero.mdef += core.values.greenGem * core.status.thisMap.ratio * 5;\ncore.status.hero.hp += core.values.yellowPotion * core.status.thisMap.ratio * 5;",
		"text": "极为珍贵的黄色晶体，蕴含的能量甚至可以产生空间波纹。\n直接增加5倍于普通黄宝石的全属性。",
		"itemEffectTip": "，全属性提升"
	},
	"I588": {
		"cls": "constants",
		"name": "清灵Ⅰ",
		"canUseItemEffect": "true",
		"text": "初阶的战复术，能够使伤口快速愈合。\n角色造成的伤害将有8%用来恢复自身生命。（上限为1000次回复）"
	},
	"I589": {
		"cls": "constants",
		"name": "雷裁Ⅰ",
		"canUseItemEffect": "true",
		"text": "初级法师常用的魔法术式。\n角色每回合额外造成对手攻防差值1/5的雷属性伤害。"
	},
	"I590": {
		"cls": "constants",
		"name": "血雨Ⅰ",
		"canUseItemEffect": "true",
		"text": "游走在生死间的刺客惯用的招式。\n使敌人前四回合受到的伤害翻4倍，造成的伤害减为1/4。"
	},
	"I591": {
		"cls": "constants",
		"name": "琉璃灵果Ⅰ",
		"canUseItemEffect": "true",
		"text": "进阶层次的战复术，能够进行战地急救。\n战前恢复相当于对手攻防之和8倍的生命，并使每点护盾的效力提升为3倍。"
	},
	"I592": {
		"cls": "constants",
		"name": "流萤幽火",
		"canUseItemEffect": "true",
		"text": "流萤，幽火。一花一界，一叶一舟。\n每回合以50%的伤害发动三次攻击，并使对方每回合损失最大生命的千分之2，生命损失持续100回合。"
	},
	"I593": {
		"cls": "constants",
		"name": "血景",
		"canUseItemEffect": "true"
	},
	"I594": {
		"cls": "constants",
		"name": "离火Ⅰ",
		"canUseItemEffect": "true",
		"text": "火焰术士的必修课，将火属性能量凝聚起来，如臂驱使。\n携带的每把红钥匙都能提供8点火元素能量，每1点火元素能量可提供0.3%攻击力，火元素能量上限为64点。"
	},
	"I595": {
		"cls": "constants",
		"name": "坎水Ⅰ",
		"canUseItemEffect": "true",
		"text": "水魔法师的拿手技能，控水魔法相对于火更为简单，因为空气中富含水元素。\n携带的每把蓝钥匙都能提供3点水元素能量，每1点水元素能量可提供0.2%防御力，水元素能量上限为90点。"
	},
	"I596": {
		"cls": "constants",
		"name": "预言者Ⅰ",
		"canUseItemEffect": "true",
		"text": "预言者说，在预测未知之物的时候，要做好最坏的打算。\n战前以普攻的情况预知回合数，标记为预知因子，每1点预知因子对敌人造成其生命千分之1.5的伤害，预知因子上限为200。"
	},
	"I597": {
		"cls": "constants",
		"name": "食星术Ⅰ",
		"canUseItemEffect": "true",
		"text": "黑色的巨龙隐匿在漆黑如墨的夜空中，携带着足以吞噬繁星的伟力。\n战斗中，角色三围属性提高对手生命值的百分之1。"
	},
	"I598": {
		"cls": "constants",
		"name": "朝露复命",
		"canUseItemEffect": "true"
	},
	"I599": {
		"cls": "constants",
		"name": "百无禁忌",
		"canUseItemEffect": "true"
	},
	"I600": {
		"cls": "constants",
		"name": "自动化开关",
		"canUseItemEffect": "true",
		"text": "一个奇怪的标识，好像…可以转动？",
		"useItemEvent": [
			{
				"type": "choices",
				"text": "这里是自动化开关！\n包含了各项简化游戏流程的自动化设置。\n为了更流畅的游戏体验，\n建议只在少数特殊情况下关闭它们。",
				"choices": [
					{
						"text": "开启自动拾取",
						"color": [
							105,
							231,
							153,
							1
						],
						"action": [
							"自动拾取已开启！",
							{
								"type": "setValue",
								"name": "flag:shiqu",
								"value": "true"
							}
						]
					},
					{
						"text": "关闭自动拾取",
						"color": [
							243,
							184,
							78,
							1
						],
						"action": [
							"自动拾取已关闭！",
							{
								"type": "setValue",
								"name": "flag:shiqu",
								"value": "false"
							}
						]
					},
					{
						"text": "开启自动清怪",
						"color": [
							144,
							191,
							234,
							1
						],
						"action": [
							"自动清怪已开启！",
							{
								"type": "setValue",
								"name": "flag:autoBattle",
								"value": "true"
							}
						]
					},
					{
						"text": "关闭自动清怪",
						"color": [
							237,
							185,
							243,
							1
						],
						"action": [
							"自动清怪已关闭！",
							{
								"type": "setValue",
								"name": "flag:autoBattle",
								"value": "false"
							}
						]
					}
				]
			}
		]
	},
	"I601": {
		"cls": "constants",
		"name": "琉璃Ⅰ",
		"canUseItemEffect": "true",
		"text": "野外生存者修习的领悟，可以提升自己的生存几率。\n对手每回合造成的伤害将有10%被吸收。"
	},
	"I602": {
		"cls": "constants",
		"name": "秘果Ⅰ",
		"canUseItemEffect": "true",
		"text": "自然精灵族的秘术，可以使身体产生一定程度的免疫能力。\n角色护盾效力增加对手攻防和的1.6倍。"
	},
	"I603": {
		"cls": "tools",
		"name": "上帝计划（God Plan）Ⅰ",
		"canUseItemEffect": "true",
		"itemEffect": null,
		"useItemEvent": [
			"字条上写着长长的说明文字：\n初次见面。\n\n不管你有没有心理准备，\n此时此刻上帝计划（God Plan）正在进行。\n\n我不知道该怎么称呼你，\r[teal]【她】\r的操纵者。\n如不介意，便直呼为\r[gray]【你】\r好啦。\n\n在本次计划当中，\n你将被允许\r[yellow]使用不包括作弊在内的一系列手段，\n达成计划所提供的目的。\r",
			"这是为轻松\r[lime]【满绿通过当前区域】\r，\n且仍然留有余力的你提供的一项难度极高的挑战。\n\n达成挑战的你，名字将被镌刻在时光的记忆里。\n\n即使是其中最简单的一项，满绿难度也足以达到\n\r[red]13级\r，在绝大多数红海魔塔之上！\n\n因此想要尝试的话，建议做好长期反复回档优化的准备，或多人合拆以交流思路！",
			"\r[gold]本区挑战目标为：不使用灵水通过该区域。\n当前区域散落的绿钥匙数量总和为36把。\r\n\n如果你\r[BlueViolet]满绿达成挑战，意味着你达到了该计划的标准，成绩为你的过关生命！\r\n\n如果你\r[#66ccff]达到挑战目标但未能满绿，同样可以提交成绩，成绩为你持有的绿钥匙数量。\r\n\n如果你\r[lime]使用了降低难度，则成绩恒为你持有的绿钥匙数量/10。\r",
			{
				"type": "setValue",
				"name": "item:I603",
				"value": "1"
			}
		],
		"text": "尽量保证你的绿钥匙数量不减少——并最终获得成为【上帝】的资格。"
	},
	"I604": {
		"cls": "constants",
		"name": "驱散环（假）",
		"canUseItemEffect": "true",
		"text": "祥瑞御免，家宅平安。\n使用后能够驱散身上的所有Buff效果。",
		"useItemEffect": "core.setFlag('s113', 0);\ncore.setFlag('s114', 0);\ncore.setFlag('s120', 0);\ncore.setFlag('s121', 0);\ncore.setFlag('s141', 0);\ncore.setFlag('s142', 0);\ncore.setFlag('s143', 0);",
		"useItemEvent": [
			{
				"type": "animate",
				"name": "water",
				"loc": "hero"
			}
		]
	},
	"I605": {
		"cls": "items",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I606": {
		"cls": "items",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I607": {
		"cls": "items",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I608": {
		"cls": "tools",
		"name": "经验倍率",
		"canUseItemEffect": "true",
		"hideInToolbox": true
	},
	"I609": {
		"cls": "items",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I610": {
		"cls": "items",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I611": {
		"cls": "items",
		"name": "斥候半刃",
		"canUseItemEffect": "true",
		"text": "青铜材质的匕首，荡漾着金属色泽的涟漪。\n攻击+480000，防御-96000。",
		"equip": {
			"type": 0,
			"value": {
				"def": -96000,
				"atk": 480000
			},
			"percentage": {}
		},
		"itemEffect": "core.status.hero.atk += 200",
		"itemEffectTip": "，攻击+200"
	},
	"I612": {
		"cls": "items",
		"name": "灵风猎刃",
		"canUseItemEffect": "true",
		"itemEffect": "core.status.hero.atk += 1500",
		"itemEffectTip": "，攻击+1500"
	},
	"I613": {
		"cls": "items",
		"name": "暗色利刃",
		"canUseItemEffect": "true",
		"itemEffect": "core.status.hero.atk += 500",
		"itemEffectTip": "，攻击+500"
	},
	"I614": {
		"cls": "items",
		"name": "青纹短剑",
		"canUseItemEffect": "true",
		"itemEffect": "core.status.hero.atk += 200",
		"itemEffectTip": "，攻击+200"
	},
	"I615": {
		"cls": "items",
		"name": "空石短剑",
		"canUseItemEffect": "true",
		"text": "天然的空心石块打造的剑。\n攻击+6000。",
		"equip": {
			"type": "装备",
			"value": {
				"atk": 6000
			},
			"percentage": {}
		},
		"itemEffect": "core.status.hero.atk += 25",
		"itemEffectTip": "，攻击+25"
	},
	"I616": {
		"cls": "items",
		"name": "灰岩重剑",
		"canUseItemEffect": "true",
		"itemEffect": "core.status.hero.atk += 3000",
		"itemEffectTip": "，攻击+3000"
	},
	"I617": {
		"cls": "items",
		"name": "戍卫制式剑",
		"canUseItemEffect": "true",
		"itemEffect": "core.status.hero.atk += 250000",
		"itemEffectTip": "，攻击+25万"
	},
	"I618": {
		"cls": "items",
		"name": "红桦木柄剑",
		"canUseItemEffect": "true",
		"itemEffect": "core.status.hero.atk += 10000000",
		"itemEffectTip": "，攻击+1000万"
	},
	"I619": {
		"cls": "items",
		"name": "灵红补给品",
		"itemEffect": "core.status.hero.hp += core.values.greenPotion * 32 * core.status.thisMap.ratio",
		"itemEffectTip": "，生命+${core.formatBigNumber(core.values.greenPotion * core.status.thisMap.ratio * 32)}",
		"useItemEffect": "core.status.hero.hp += core.values.greenPotion * 32",
		"text": "极为精纯的活泼能量，甚至有起死回生的功用。\n增加相当于256倍红血瓶的生命。"
	},
	"I620": {
		"cls": "items",
		"name": "灵蓝补给品",
		"itemEffect": "core.status.hero.hp += core.values.greenPotion * 64 * core.status.thisMap.ratio",
		"itemEffectTip": "，生命+${core.formatBigNumber(core.values.greenPotion * core.status.thisMap.ratio * 64)}",
		"useItemEffect": "core.status.hero.hp += core.values.greenPotion * 64",
		"text": "极为精纯的活泼能量，甚至有起死回生的功用。\n增加相当于256倍蓝血瓶的生命。"
	},
	"I621": {
		"cls": "items",
		"name": "灵黄补给品",
		"itemEffect": "core.status.hero.hp += core.values.greenPotion * 128 * core.status.thisMap.ratio",
		"itemEffectTip": "，生命+${core.formatBigNumber(core.values.greenPotion * core.status.thisMap.ratio * 128)}",
		"useItemEffect": "core.status.hero.hp += core.values.greenPotion * 128",
		"text": "极为精纯的活泼能量，甚至有起死回生的功用。\n增加相当于256倍黄血瓶的生命。"
	},
	"I622": {
		"cls": "items",
		"name": "灵绿补给品",
		"itemEffect": "core.status.hero.hp += core.values.greenPotion * 256 * core.status.thisMap.ratio",
		"itemEffectTip": "，生命+${core.formatBigNumber(core.values.greenPotion * core.status.thisMap.ratio * 256)}",
		"useItemEffect": "core.status.hero.hp += core.values.greenPotion * 256",
		"text": "极为精纯的活泼能量，甚至有起死回生的功用。\n增加相当于256倍绿血瓶的生命。"
	},
	"I623": {
		"cls": "items",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I624": {
		"cls": "items",
		"name": "冰淼之剑",
		"canUseItemEffect": "true"
	},
	"I625": {
		"cls": "items",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I626": {
		"cls": "items",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I627": {
		"cls": "items",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I628": {
		"cls": "items",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I629": {
		"cls": "items",
		"name": "血骸剑",
		"canUseItemEffect": "true",
		"itemEffect": "core.status.hero.atk += 35000",
		"itemEffectTip": "，攻击+35000"
	},
	"I630": {
		"cls": "items",
		"name": "裁夜",
		"canUseItemEffect": "true",
		"itemEffect": "core.status.hero.atk += 50e12",
		"itemEffectTip": "，攻击+50兆"
	},
	"I631": {
		"cls": "items",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I632": {
		"cls": "items",
		"name": "火蝶铃",
		"canUseItemEffect": "true",
		"itemEffect": "core.status.hero.mdef += 100000;\ncore.status.hero.hp += 2000000;",
		"itemEffectTip": "，护盾+10万，生命+200万"
	},
	"I633": {
		"cls": "items",
		"name": "天籁之铃",
		"canUseItemEffect": "true",
		"itemEffect": "core.status.hero.mdef += 10000;\ncore.status.hero.hp += 200000;",
		"itemEffectTip": "，护盾+10000，生命+20万"
	},
	"I634": {
		"cls": "items",
		"name": "地陨之铃",
		"canUseItemEffect": "true",
		"itemEffect": "core.status.hero.mdef += 30000;\ncore.status.hero.hp += 600000;",
		"itemEffectTip": "，护盾+30000，生命+60万"
	},
	"I635": {
		"cls": "items",
		"name": "殿堂红宝石",
		"canUseItemEffect": "true",
		"itemEffect": "core.status.hero.atk += core.values.redGem * core.status.thisMap.ratio * 10",
		"itemEffectTip": "，攻击+${core.formatBigNumber(core.values.redGem * core.status.thisMap.ratio*10)}",
		"text": "普通人一生难得一见的红色晶体，能够使身体如有神助，神力盖世。\n直接增加10倍于普通红宝石的攻击力。"
	},
	"I636": {
		"cls": "items",
		"name": "殿堂蓝宝石",
		"canUseItemEffect": "true",
		"itemEffect": "core.status.hero.def += core.values.blueGem * core.status.thisMap.ratio * 10",
		"itemEffectTip": "，防御+${core.formatBigNumber(core.values.blueGem * core.status.thisMap.ratio*10)}",
		"text": "普通人一生难得一见的蓝色晶体，能够使人的筋骨产生质的蜕变，脱胎换骨。\n直接增加10倍于普通蓝宝石的防御力。"
	},
	"I637": {
		"cls": "items",
		"name": "殿堂绿宝石",
		"itemEffect": "core.status.hero.mdef += core.values.greenGem * core.status.thisMap.ratio * 10",
		"itemEffectTip": "，护盾+${core.formatBigNumber(core.values.greenGem * core.status.thisMap.ratio*10)}",
		"text": "普通人一生难得一见的绿色晶体，蕴含足以庇佑万物的神力。\n直接增加10倍于普通绿宝石的护盾。"
	},
	"I638": {
		"cls": "items",
		"name": "殿堂黄宝石",
		"itemEffect": "core.status.hero.atk += core.values.redGem * core.status.thisMap.ratio * 10;\ncore.status.hero.def += core.values.blueGem * core.status.thisMap.ratio * 10;\ncore.status.hero.mdef += core.values.greenGem * core.status.thisMap.ratio * 10;\ncore.status.hero.hp += core.values.yellowPotion * core.status.thisMap.ratio * 10;",
		"text": "普通人一生难得一见的黄色晶体，它恐怖的能量波动足以扭曲时空。\n直接增加10倍于普通黄宝石的全属性。",
		"itemEffectTip": "，全属性提升"
	},
	"I639": {
		"cls": "items",
		"name": "史诗红宝石",
		"canUseItemEffect": "true",
		"itemEffect": "core.status.hero.atk += core.values.redGem * core.status.thisMap.ratio * 20",
		"itemEffectTip": "，攻击+${core.formatBigNumber(core.values.redGem * core.status.thisMap.ratio*20)}",
		"text": "普通人一生难得一见的红色晶体，能够使身体如有神助，神力盖世。\n直接增加20倍于普通红宝石的攻击力。"
	},
	"I640": {
		"cls": "items",
		"name": "史诗蓝宝石",
		"canUseItemEffect": "true",
		"itemEffect": "core.status.hero.def += core.values.blueGem * core.status.thisMap.ratio * 20",
		"itemEffectTip": "，防御+${core.formatBigNumber(core.values.blueGem * core.status.thisMap.ratio*20)}"
	},
	"I641": {
		"cls": "items",
		"name": "史诗绿宝石",
		"canUseItemEffect": "true",
		"text": "世间罕有的绿色晶体，其蓬勃的生命力足以滋养一方小世界。\n直接增加20倍于普通绿宝石的护盾。",
		"itemEffect": "core.status.hero.mdef += core.values.greenGem * core.status.thisMap.ratio * 20",
		"itemEffectTip": "，护盾+${core.formatBigNumber(core.values.greenGem * core.status.thisMap.ratio*20)}"
	},
	"I642": {
		"cls": "items",
		"name": "史诗黄宝石",
		"canUseItemEffect": "true",
		"itemEffect": "core.status.hero.atk += core.values.redGem * core.status.thisMap.ratio * 20;\ncore.status.hero.def += core.values.blueGem * core.status.thisMap.ratio * 20;\ncore.status.hero.mdef += core.values.greenGem * core.status.thisMap.ratio * 20;\ncore.status.hero.hp += core.values.yellowPotion * core.status.thisMap.ratio * 20;",
		"itemEffectTip": "，全属性提升",
		"text": "直接增加20倍于普通黄宝石的全属性。"
	},
	"I643": {
		"cls": "items",
		"name": "传说红宝石",
		"canUseItemEffect": "true",
		"itemEffect": "core.status.hero.atk += core.values.redGem * core.status.thisMap.ratio * 50",
		"itemEffectTip": "，攻击+${core.formatBigNumber(core.values.redGem * core.status.thisMap.ratio*50)}",
		"text": "普通人一生难得一见的红色晶体，能够使身体如有神助，神力盖世。\n直接增加50倍于普通红宝石的攻击力。"
	},
	"I644": {
		"cls": "items",
		"name": "传说蓝宝石",
		"canUseItemEffect": "true",
		"itemEffect": "core.status.hero.def += core.values.blueGem * core.status.thisMap.ratio * 50",
		"itemEffectTip": "，防御+${core.formatBigNumber(core.values.blueGem * core.status.thisMap.ratio*50)}"
	},
	"I645": {
		"cls": "items",
		"name": "传说绿宝石",
		"canUseItemEffect": "true",
		"text": "世间罕有的绿色晶体，其蓬勃的生命力足以滋养一方小世界。\n直接增加50倍于普通绿宝石的护盾。",
		"itemEffect": "core.status.hero.mdef += core.values.greenGem * core.status.thisMap.ratio * 50",
		"itemEffectTip": "，护盾+${core.formatBigNumber(core.values.greenGem * core.status.thisMap.ratio*50)}"
	},
	"I646": {
		"cls": "items",
		"name": "传说黄宝石",
		"canUseItemEffect": "true",
		"itemEffect": "core.status.hero.atk += core.values.redGem * core.status.thisMap.ratio * 50;\ncore.status.hero.def += core.values.blueGem * core.status.thisMap.ratio * 50;\ncore.status.hero.mdef += core.values.greenGem * core.status.thisMap.ratio * 50;\ncore.status.hero.hp += core.values.yellowPotion * core.status.thisMap.ratio * 100;",
		"itemEffectTip": "，全属性提升",
		"text": "其出世时，世人为之的震撼足以载入史册的黄色晶体。\n直接增加50倍于普通黄宝石的全属性。"
	},
	"I647": {
		"cls": "items",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I648": {
		"cls": "items",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I649": {
		"cls": "items",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I650": {
		"cls": "items",
		"name": "光风之藤",
		"canUseItemEffect": "true",
		"itemEffect": "core.status.hero.mdef += 300000;\ncore.status.hero.hp += 6000000;",
		"itemEffectTip": "，护盾+30万，生命+600万"
	},
	"I651": {
		"cls": "items",
		"name": "洛云之藤",
		"canUseItemEffect": "true",
		"itemEffect": "core.status.hero.mdef += 6e12;\ncore.status.hero.hp += 600e12;",
		"itemEffectTip": "，护盾+6兆，生命+600兆"
	},
	"I652": {
		"cls": "items",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I653": {
		"cls": "items",
		"name": "止水问隙",
		"canUseItemEffect": "true",
		"itemEffect": "core.status.hero.atk += 40e8",
		"itemEffectTip": "，攻击+40亿"
	},
	"I654": {
		"cls": "items",
		"name": "力量结晶",
		"canUseItemEffect": "true",
		"itemEffect": "core.status.hero.atk += 20000",
		"itemEffectTip": "，攻击+20000"
	},
	"I655": {
		"cls": "items",
		"name": "炙热果实",
		"canUseItemEffect": "true",
		"itemEffect": "core.status.hero.atk += 9000",
		"itemEffectTip": "，攻击+9000"
	},
	"I656": {
		"cls": "items",
		"name": "渊虹",
		"canUseItemEffect": "true"
	},
	"I657": {
		"cls": "items",
		"name": "隙光",
		"canUseItemEffect": "true",
		"itemEffect": "core.status.hero.atk += 5000e8",
		"itemEffectTip": "，攻击+5000亿"
	},
	"I658": {
		"cls": "tools",
		"name": "禀赋加成",
		"canUseItemEffect": null,
		"text": "天才不讲理！就是这样。\n献祭时额外获得相当于该道具倍数的能力。",
		"hideInToolbox": true
	},
	"I729": {
		"cls": "constants",
		"name": "妄无之印",
		"canUseItemEffect": "true",
		"text": "红海领悟。仿佛是万物皆归于沉寂，唯有那印记散发着淡淡的光泽。\n每回合以自身80%攻击力与20%防御力的和，作为攻击力并连续发动两次攻击。"
	},
	"I730": {
		"cls": "items",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I731": {
		"cls": "constants",
		"name": "繁花血景",
		"canUseItemEffect": "true",
		"text": "红海领悟。传说中是两位幻神强者联手缔造的攻坚技，一人为血，一人为花。\n在接下来的战斗中爆发出3倍生命力、1.5倍攻防。（本区面对头目时使用）"
	},
	"I732": {
		"cls": "tools",
		"name": "磁吸石",
		"canUseItemEffect": "(function () {\n\t//if (core.flags.flyNearStair && !core.nearStair()) return false;\n\treturn !core.hasEnemyLeft('E1500');\n})();",
		"useItemEffect": "\t\tfor (var i = 1; i <= 13; i++) {\n\t\t\tvar x1 = core.clamp(core.nextX(i), 0, 12),\n\t\t\t\ty1 = core.clamp(core.nextY(i), 0, 12);\n\t\t\t// 判断格子内的事件是否为道具\n\t\t\tif (core.getBlockCls(x1, y1) == \"items\") {\n\t\t\t\tvar id = core.getBlockId(x1, y1);\n\n\t\t\t\tcore.getItem(id, 1, x1, y1);\n\t\t\t}\n\n\t\t}",
		"useItemEvent": [
			{
				"type": "animate",
				"name": "light1",
				"loc": "hero"
			}
		],
		"text": "远程拾取面对方向的所有物品。"
	},
	"I733": {
		"cls": "tools",
		"name": "换位标靶",
		"canUseItemEffect": "(function () {\n\t//if (core.flags.flyNearStair && !core.nearStair()) return false;\n\treturn !core.hasEnemyLeft('E1500');\n})();",
		"useItemEvent": [
			{
				"type": "if",
				"condition": "Object.values(core.utils.scan).some(v => {\n    const x = core.status.hero.loc.x + v.x * 1;\n    const y = core.status.hero.loc.y + v.y * 1;\n    return !!core.floors[core.status.floorId].changeFloor[`${x},${y}`];\n})",
				"true": [
					{
						"type": "animate",
						"name": "wuyu",
						"loc": "hero"
					},
					{
						"type": "setValue",
						"name": "item:I733",
						"operator": "+=",
						"value": "1"
					}
				],
				"false": [
					{
						"type": "if",
						"condition": "Object.values(core.utils.scan).some(v => {\n    const x = core.status.hero.loc.x + v.x * 2;\n    const y = core.status.hero.loc.y + v.y * 2;\n    return !!core.floors[core.status.floorId].changeFloor[`${x},${y}`];\n})\n",
						"true": [
							{
								"type": "animate",
								"name": "wuyu",
								"loc": "hero"
							},
							{
								"type": "setValue",
								"name": "item:I733",
								"operator": "+=",
								"value": "1"
							}
						],
						"false": [
							{
								"type": "animate",
								"name": "buff",
								"loc": "hero"
							},
							{
								"type": "if",
								"condition": "((core.nextX(1)===core.getHeroLoc().x)&&(core.nextY(1)===core.getHeroLoc().y -1))",
								"true": [
									{
										"type": "move",
										"loc": [
											"core.getHeroLoc().x",
											"core.getHeroLoc().y -1"
										],
										"time": 150,
										"keep": true,
										"async": true,
										"steps": [
											"up:1"
										]
									},
									{
										"type": "move",
										"loc": [
											"core.getHeroLoc().x",
											"core.getHeroLoc().y -2"
										],
										"time": 150,
										"keep": true,
										"steps": [
											"down:1"
										]
									},
									{
										"type": "move",
										"loc": [
											"core.getHeroLoc().x",
											"core.getHeroLoc().y +1"
										],
										"time": 150,
										"keep": true,
										"async": true,
										"steps": [
											"down:1"
										]
									},
									{
										"type": "move",
										"loc": [
											"core.getHeroLoc().x",
											"core.getHeroLoc().y +2"
										],
										"time": 150,
										"keep": true,
										"steps": [
											"up:1"
										]
									},
									{
										"type": "waitAsync"
									}
								]
							},
							{
								"type": "if",
								"condition": "((core.nextX(1)===core.getHeroLoc().x+1)&&(core.nextY(1)===core.getHeroLoc().y ))",
								"true": [
									{
										"type": "move",
										"loc": [
											"core.getHeroLoc().x-1",
											"core.getHeroLoc().y"
										],
										"time": 150,
										"keep": true,
										"async": true,
										"steps": [
											"left:1"
										]
									},
									{
										"type": "move",
										"loc": [
											"core.getHeroLoc().x-2",
											"core.getHeroLoc().y"
										],
										"time": 150,
										"keep": true,
										"steps": [
											"right:1"
										]
									},
									{
										"type": "move",
										"loc": [
											"core.getHeroLoc().x+1",
											"core.getHeroLoc().y "
										],
										"time": 150,
										"keep": true,
										"async": true,
										"steps": [
											"right:1"
										]
									},
									{
										"type": "move",
										"loc": [
											"core.getHeroLoc().x+2",
											"core.getHeroLoc().y "
										],
										"time": 150,
										"keep": true,
										"steps": [
											"left:1"
										]
									},
									{
										"type": "waitAsync"
									}
								]
							},
							{
								"type": "if",
								"condition": "((core.nextX(1)===core.getHeroLoc().x)&&(core.nextY(1)===core.getHeroLoc().y +1))",
								"true": [
									{
										"type": "move",
										"loc": [
											"core.getHeroLoc().x",
											"core.getHeroLoc().y -1"
										],
										"time": 150,
										"keep": true,
										"async": true,
										"steps": [
											"up:1"
										]
									},
									{
										"type": "move",
										"loc": [
											"core.getHeroLoc().x",
											"core.getHeroLoc().y -2"
										],
										"time": 150,
										"keep": true,
										"steps": [
											"down:1"
										]
									},
									{
										"type": "move",
										"loc": [
											"core.getHeroLoc().x",
											"core.getHeroLoc().y +1"
										],
										"time": 150,
										"keep": true,
										"async": true,
										"steps": [
											"down:1"
										]
									},
									{
										"type": "move",
										"loc": [
											"core.getHeroLoc().x",
											"core.getHeroLoc().y +2"
										],
										"time": 150,
										"keep": true,
										"steps": [
											"up:1"
										]
									},
									{
										"type": "waitAsync"
									}
								]
							},
							{
								"type": "if",
								"condition": "((core.nextX(1)===core.getHeroLoc().x-1)&&(core.nextY(1)===core.getHeroLoc().y))",
								"true": [
									{
										"type": "move",
										"loc": [
											"core.getHeroLoc().x-1",
											"core.getHeroLoc().y"
										],
										"time": 150,
										"keep": true,
										"async": true,
										"steps": [
											"left:1"
										]
									},
									{
										"type": "move",
										"loc": [
											"core.getHeroLoc().x-2",
											"core.getHeroLoc().y"
										],
										"time": 150,
										"keep": true,
										"steps": [
											"right:1"
										]
									},
									{
										"type": "move",
										"loc": [
											"core.getHeroLoc().x+1",
											"core.getHeroLoc().y "
										],
										"time": 150,
										"keep": true,
										"async": true,
										"steps": [
											"right:1"
										]
									},
									{
										"type": "move",
										"loc": [
											"core.getHeroLoc().x+2",
											"core.getHeroLoc().y "
										],
										"time": 150,
										"keep": true,
										"steps": [
											"left:1"
										]
									},
									{
										"type": "waitAsync"
									}
								]
							}
						]
					}
				]
			}
		],
		"text": "同时交换角色面向两格、背向两格事件的位置（距楼梯1-2格十字范围无效）。",
		"useItemEffect": "null"
	},
	"I734": {
		"cls": "items",
		"name": "初等进化结晶",
		"canUseItemEffect": "true",
		"text": "天地间充沛的能量滋养诞生的晶体，\n接触后能够化作海量的经验为人所用。\n角色增加200万经验。",
		"itemEffect": "core.status.hero.exp += 1000",
		"itemEffectTip": "，经验+1000"
	},
	"I735": {
		"cls": "items",
		"name": "高等进化结晶",
		"canUseItemEffect": "true",
		"text": "天地间充沛的能量滋养诞生的晶体，\n接触后能够化作海量的经验为人所用。\n角色增加50亿经验。",
		"itemEffect": "core.status.hero.exp += 50e8",
		"itemEffectTip": "，经验+50亿"
	},
	"I736": {
		"cls": "items",
		"name": "极品进化结晶",
		"canUseItemEffect": "true",
		"text": "天地间充沛的能量滋养诞生的晶体，\n接触后能够化作海量的经验为人所用。\n角色增加1000亿经验。",
		"itemEffect": "core.status.hero.exp += 1000e8",
		"itemEffectTip": "，经验+1000亿"
	},
	"I737": {
		"cls": "items",
		"name": "史诗的进化结晶",
		"canUseItemEffect": "true",
		"text": "天地间充沛的能量滋养诞生的晶体，\n接触后能够化作海量的领悟为人所用。\n角色增加3兆经验。",
		"itemEffect": "core.status.hero.exp += 3e12",
		"itemEffectTip": "，经验+3兆"
	},
	"I738": {
		"cls": "items",
		"name": "传说的进化结晶",
		"canUseItemEffect": "true",
		"text": "天地间充沛的能量滋养诞生的晶体，\n接触后能够化作海量的领悟为人所用。\n角色增加100万领悟。",
		"itemEffect": "core.status.hero.exp += 100e12",
		"itemEffectTip": "，经验+100兆"
	},
	"I739": {
		"cls": "items",
		"name": "神话的进化结晶",
		"canUseItemEffect": "true",
		"text": "天地间充沛的能量滋养诞生的晶体，\n接触后能够化作海量的领悟为人所用。\n角色增加1000万领悟。",
		"itemEffect": "core.status.hero.exp += 5000e12",
		"itemEffectTip": "，经验+5000兆"
	},
	"I740": {
		"cls": "items",
		"name": "不朽的进化结晶",
		"canUseItemEffect": "true",
		"text": "天地间充沛的能量滋养诞生的晶体，\n接触后能够化作海量的领悟为人所用。\n角色增加1亿领悟。",
		"itemEffect": "core.status.hero.exp += 10e16",
		"itemEffectTip": "，经验+10京"
	},
	"I743": {
		"cls": "constants",
		"name": "清灵Ⅱ",
		"canUseItemEffect": "true",
		"text": "初阶的战复术，能够使伤口快速愈合。\n角色造成的伤害将有10%用来恢复自身生命。（上限为1000次回复）"
	},
	"I744": {
		"cls": "constants",
		"name": "清灵Ⅲ",
		"canUseItemEffect": "true",
		"text": "初阶的战复术，能够使伤口快速愈合。\n角色造成的伤害将有12%用来恢复自身生命。（上限为1000次回复）"
	},
	"I745": {
		"cls": "constants",
		"name": "清灵Max",
		"canUseItemEffect": "true",
		"text": "初阶的战复术，能够使伤口快速愈合。\n角色造成的伤害将有16%用来恢复自身生命。（上限为1000次回复）"
	},
	"I746": {
		"cls": "constants",
		"name": "雷裁Ⅱ",
		"canUseItemEffect": "true",
		"text": "初级法师常用的魔法术式。\n角色每回合额外造成对手攻防差值1/4的雷属性伤害。"
	},
	"I747": {
		"cls": "constants",
		"name": "雷裁Ⅲ",
		"canUseItemEffect": "true",
		"text": "初级法师常用的魔法术式。\n角色每回合额外造成对手攻防差值3/10的雷属性伤害。"
	},
	"I748": {
		"cls": "constants",
		"name": "雷裁Max",
		"canUseItemEffect": "true",
		"text": "初级法师常用的魔法术式。\n角色每回合额外造成对手攻防差值2/5的雷属性伤害。"
	},
	"I749": {
		"cls": "constants",
		"name": "血雨Ⅱ",
		"canUseItemEffect": "true",
		"text": "游走在生死间的刺客惯用的招式。\n使敌人前五回合受到的伤害翻4倍，造成的伤害减为1/4。"
	},
	"I750": {
		"cls": "constants",
		"name": "血雨Ⅲ",
		"canUseItemEffect": "true",
		"text": "游走在生死间的刺客惯用的招式。\n使敌人前六回合受到的伤害翻4倍，造成的伤害减为1/4。"
	},
	"I751": {
		"cls": "constants",
		"name": "血雨Max",
		"canUseItemEffect": "true",
		"text": "游走在生死间的刺客惯用的招式。\n使敌人前八回合受到的伤害翻4倍，造成的伤害减为1/4。"
	},
	"I752": {
		"cls": "constants",
		"name": "琉璃Ⅱ",
		"canUseItemEffect": "true",
		"text": "野外生存者修习的领悟，可以提升自己的生存几率。\n对手每回合造成的伤害将有12.5%被吸收。"
	},
	"I753": {
		"cls": "constants",
		"name": "琉璃Ⅲ",
		"canUseItemEffect": "true",
		"text": "野外生存者修习的领悟，可以提升自己的生存几率。\n对手每回合造成的伤害将有15%被吸收。"
	},
	"I754": {
		"cls": "constants",
		"name": "琉璃Max",
		"canUseItemEffect": "true",
		"text": "野外生存者修习的领悟，可以提升自己的生存几率。\n对手每回合造成的伤害将有20%被吸收。"
	},
	"I755": {
		"cls": "constants",
		"name": "秘果Ⅱ",
		"canUseItemEffect": "true",
		"text": "自然精灵族的秘术，可以使身体产生一定程度的免疫能力。\n角色护盾效力增加对手攻防和的2倍。"
	},
	"I756": {
		"cls": "constants",
		"name": "秘果Ⅲ",
		"canUseItemEffect": "true",
		"text": "自然精灵族的秘术，可以使身体产生一定程度的免疫能力。\n角色护盾效力增加对手攻防和的2.4倍。"
	},
	"I757": {
		"cls": "constants",
		"name": "秘果Max",
		"canUseItemEffect": "true",
		"text": "自然精灵族的秘术，可以使身体产生一定程度的免疫能力。\n角色护盾效力增加对手攻防和的3.2倍。"
	},
	"I772": {
		"cls": "items",
		"name": "橡木圆盾",
		"canUseItemEffect": "true",
		"itemEffect": "core.status.hero.def += 3000",
		"itemEffectTip": "，防御+3000"
	},
	"I773": {
		"cls": "items",
		"name": "轻质圆盾",
		"canUseItemEffect": "true",
		"text": "晒干的干草编织成的盾牌。\n防御+3000。",
		"equip": {
			"type": "装备",
			"value": {
				"def": 3000
			},
			"percentage": {}
		},
		"itemEffect": "core.status.hero.def += 25",
		"itemEffectTip": "，防御+25"
	},
	"I774": {
		"cls": "items",
		"name": "夯土圆盾",
		"canUseItemEffect": "true",
		"itemEffect": "core.status.hero.def += 200",
		"itemEffectTip": "，防御+200"
	},
	"I775": {
		"cls": "items",
		"name": "合金甲",
		"canUseItemEffect": "true",
		"itemEffect": "core.status.hero.def += 35000",
		"itemEffectTip": "，防御+35000"
	},
	"I776": {
		"cls": "items",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I777": {
		"cls": "items",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I778": {
		"cls": "items",
		"name": "守护之盾",
		"canUseItemEffect": "true",
		"itemEffect": "core.status.hero.def += 10000",
		"itemEffectTip": "，防御+10000"
	},
	"I779": {
		"cls": "items",
		"name": "咏唱之盾",
		"canUseItemEffect": "true",
		"itemEffect": "core.status.hero.def += 30000",
		"itemEffectTip": "，防御+30000"
	},
	"I780": {
		"cls": "items",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I781": {
		"cls": "items",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I782": {
		"cls": "items",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I783": {
		"cls": "items",
		"name": "逆命镜心盾",
		"canUseItemEffect": "true",
		"itemEffect": "core.status.hero.def += 4000",
		"itemEffectTip": "，防御+4000"
	},
	"I784": {
		"cls": "items",
		"name": "冰寒果实",
		"canUseItemEffect": "true",
		"itemEffect": "core.status.hero.def += 1200e8",
		"itemEffectTip": "，防御+1200亿"
	},
	"I785": {
		"cls": "items",
		"name": "灵巧结晶",
		"canUseItemEffect": "true",
		"itemEffect": "core.status.hero.def += 20000",
		"itemEffectTip": "，防御+20000"
	},
	"I786": {
		"cls": "items",
		"name": "悬星",
		"canUseItemEffect": "true",
		"itemEffect": "core.status.hero.def += 1000e12",
		"itemEffectTip": "，防御+1000兆"
	},
	"I787": {
		"cls": "items",
		"name": "鲜血盾",
		"canUseItemEffect": "true",
		"text": "经由红海异兽的精血淬炼的盾牌。\n防御+72000。",
		"equip": {
			"type": 0,
			"value": {
				"def": 72000
			},
			"percentage": {}
		},
		"itemEffect": "core.status.hero.def += 200",
		"itemEffectTip": "，防御+200"
	},
	"I788": {
		"cls": "items",
		"name": "金痕盾",
		"canUseItemEffect": "true",
		"itemEffect": "core.status.hero.def += 500",
		"itemEffectTip": "，防御+500"
	},
	"I789": {
		"cls": "items",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I790": {
		"cls": "items",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I791": {
		"cls": "items",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I792": {
		"cls": "items",
		"name": "粗麻筝形盾",
		"canUseItemEffect": "true",
		"itemEffectTip": "，防御+30亿",
		"itemEffect": "core.status.hero.def += 30e8",
		"useItemEvent": [
			"获得了纳家灵宝\r[purple]【伊芙】。\r\n基础防御增加了30亿。"
		]
	},
	"I793": {
		"cls": "items",
		"name": "沉璧古盾",
		"canUseItemEffect": "true",
		"itemEffect": "core.status.hero.def += 5000e8",
		"itemEffectTip": "，防御+5000亿"
	},
	"I794": {
		"cls": "items",
		"name": "挽月古盾",
		"canUseItemEffect": "true"
	},
	"I795": {
		"cls": "items",
		"name": "瑶池灵环",
		"canUseItemEffect": "true",
		"itemEffect": "core.status.hero.mdef += 30000000;\ncore.status.hero.hp += 600000000;",
		"itemEffectTip": "，护盾+3000万，生命+6亿"
	},
	"I796": {
		"cls": "items",
		"name": "轩辕灵环",
		"canUseItemEffect": "true",
		"itemEffect": "core.status.hero.mdef += 9000000;\ncore.status.hero.hp += 180000000;",
		"itemEffectTip": "，护盾+900万，生命+1.8亿"
	},
	"I797": {
		"cls": "items",
		"name": "千嶂重山盾",
		"canUseItemEffect": "true"
	},
	"I798": {
		"cls": "items",
		"name": "铸铁塔盾",
		"canUseItemEffect": "true",
		"itemEffect": "core.status.hero.def += 25e4",
		"itemEffectTip": "，防御+25万"
	},
	"I799": {
		"cls": "items",
		"name": "岩钉大盾",
		"canUseItemEffect": "true",
		"itemEffect": "core.status.hero.def += 5000e4",
		"itemEffectTip": "，防御+5000万"
	},
	"I800": {
		"cls": "items",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I801": {
		"cls": "items",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I802": {
		"cls": "items",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I803": {
		"cls": "items",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I804": {
		"cls": "equips",
		"name": "能力加成",
		"canUseItemEffect": "true",
		"text": "你曾经所经历的一切，都将化为此后前行的助力。\n每个该道具为角色提供相当于基础属性10%的三围属性。",
		"hideInToolbox": false
	},
	"I805": {
		"cls": "equips",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I820": {
		"cls": "items",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I821": {
		"cls": "tools",
		"name": "能力加成",
		"canUseItemEffect": null,
		"text": "你曾经所经历的一切，都将化为此后前行的助力。\n每个该道具为角色提供相当于基础属性的三围数据。",
		"hideInToolbox": true
	},
	"I822": {
		"cls": "constants",
		"name": "离火Ⅱ",
		"canUseItemEffect": "true",
		"text": "火焰术士的必修课，将火属性能量凝聚起来，如臂驱使。\n携带的每把红钥匙都能提供8点火元素能量，每1点火元素能量可提供0.36%攻击力，火元素能量上限为64点。"
	},
	"I823": {
		"cls": "constants",
		"name": "离火Ⅲ",
		"canUseItemEffect": "true",
		"text": "火焰术士的必修课，将火属性能量凝聚起来，如臂驱使。\n携带的每把红钥匙都能提供8点火元素能量，每1点火元素能量可提供0.42%攻击力，火元素能量上限为64点。"
	},
	"I824": {
		"cls": "constants",
		"name": "离火Ⅳ",
		"canUseItemEffect": "true",
		"text": "火焰术士的必修课，将火属性能量凝聚起来，如臂驱使。\n携带的每把红钥匙都能提供8点火元素能量，每1点火元素能量可提供0.42%攻击力，火元素能量上限为80点。"
	},
	"I825": {
		"cls": "constants",
		"name": "离火Ⅴ",
		"canUseItemEffect": "true",
		"text": "火焰术士的必修课，将火属性能量凝聚起来，如臂驱使。\n携带的每把红钥匙都能提供8点火元素能量，每1点火元素能量可提供0.42%攻击力，火元素能量上限为96点。"
	},
	"I826": {
		"cls": "constants",
		"name": "离火Max",
		"canUseItemEffect": "true",
		"text": "火焰术士的必修课，将火属性能量凝聚起来，如臂驱使。\n携带的每把红钥匙都能提供8点火元素能量，每1点火元素能量可提供0.495%攻击力，火元素能量上限为96点。"
	},
	"I827": {
		"cls": "constants",
		"name": "坎水Ⅱ",
		"canUseItemEffect": "true",
		"text": "水魔法师的拿手技能，控水魔法相对于火更为简单，因为空气中富含水元素。\n携带的每把蓝钥匙都能提供3点水元素能量，每1点水元素能量可提供0.24%防御力，水元素能量上限为90点。"
	},
	"I828": {
		"cls": "constants",
		"name": "坎水Ⅲ",
		"canUseItemEffect": "true",
		"text": "水魔法师的拿手技能，控水魔法相对于火更为简单，因为空气中富含水元素。\n携带的每把蓝钥匙都能提供3点水元素能量，每1点水元素能量可提供0.28%防御力，水元素能量上限为90点。"
	},
	"I829": {
		"cls": "constants",
		"name": "坎水Ⅳ",
		"canUseItemEffect": "true",
		"text": "水魔法师的拿手技能，控水魔法相对于火更为简单，因为空气中富含水元素。\n携带的每把蓝钥匙都能提供3点水元素能量，每1点水元素能量可提供0.28%防御力，水元素能量上限为111点。"
	},
	"I830": {
		"cls": "constants",
		"name": "坎水Ⅴ",
		"canUseItemEffect": "true",
		"text": "水魔法师的拿手技能，控水魔法相对于火更为简单，因为空气中富含水元素。\n携带的每把蓝钥匙都能提供3点水元素能量，每1点水元素能量可提供0.28%防御力，水元素能量上限为132点。"
	},
	"I831": {
		"cls": "constants",
		"name": "坎水Max",
		"canUseItemEffect": "true",
		"text": "水魔法师的拿手技能，控水魔法相对于火更为简单，因为空气中富含水元素。\n携带的每把蓝钥匙都能提供3点水元素能量，每1点水元素能量可提供0.33%防御力，水元素能量上限为132点。"
	},
	"I832": {
		"cls": "constants",
		"name": "预言者Ⅱ",
		"canUseItemEffect": "true",
		"text": "预言者说，在预测未知之物的时候，要做好最坏的打算。\n战前以普攻的情况预知回合数，标记为预知因子，每1点预知因子对敌人造成其生命千分之1.8的伤害，预知因子上限为200。"
	},
	"I833": {
		"cls": "constants",
		"name": "预言者Ⅲ",
		"canUseItemEffect": "true",
		"text": "预言者说，在预测未知之物的时候，要做好最坏的打算。\n战前以普攻的情况预知回合数，标记为预知因子，每1点预知因子对敌人造成其生命千分之2.1的伤害，预知因子上限为200。"
	},
	"I834": {
		"cls": "constants",
		"name": "预言者Ⅳ",
		"canUseItemEffect": "true",
		"text": "预言者说，在预测未知之物的时候，要做好最坏的打算。\n战前以普攻的情况预知回合数，标记为预知因子，每1点预知因子对敌人造成其生命千分之2.1的伤害，预知因子上限为250。"
	},
	"I835": {
		"cls": "constants",
		"name": "预言者Ⅴ",
		"canUseItemEffect": "true",
		"text": "预言者说，在预测未知之物的时候，要做好最坏的打算。\n战前以普攻的情况预知回合数，标记为预知因子，每1点预知因子对敌人造成其生命千分之2.1的伤害，预知因子上限为300。"
	},
	"I836": {
		"cls": "constants",
		"name": "预言者Max",
		"canUseItemEffect": "true",
		"text": "预言者说，在预测未知之物的时候，要做好最坏的打算。\n战前以普攻的情况预知回合数，标记为预知因子，每1点预知因子对敌人造成其生命千分之2.5的伤害，预知因子上限为300。"
	},
	"I837": {
		"cls": "constants",
		"name": "食星术Ⅱ",
		"canUseItemEffect": "true",
		"text": "黑色的巨龙隐匿在漆黑如墨的夜空中，携带着足以吞噬繁星的伟力。\n战斗中，角色三围属性提高对手生命值的百分之1.5。"
	},
	"I838": {
		"cls": "constants",
		"name": "吞食者Ⅲ",
		"canUseItemEffect": "true",
		"text": "神话里未来会有一场灾难降临，吞食殆尽人间的一切。\n战斗中，角色三围属性提高对手生命值的万分之7。"
	},
	"I839": {
		"cls": "constants",
		"name": "吞食者Ⅳ",
		"canUseItemEffect": "true",
		"text": "神话里未来会有一场灾难降临，吞食殆尽人间的一切。\n战斗中，角色三围属性提高对手生命值的万分之8.25。"
	},
	"I840": {
		"cls": "constants",
		"name": "吞食者Ⅴ",
		"canUseItemEffect": "true",
		"text": "神话里未来会有一场灾难降临，吞食殆尽人间的一切。\n战斗中，角色三围属性提高对手生命值的万分之9.5。"
	},
	"I841": {
		"cls": "constants",
		"name": "吞食者Max",
		"canUseItemEffect": "true",
		"text": "神话里未来会有一场灾难降临，吞食殆尽人间的一切。\n战斗中，角色三围属性提高对手生命值的万分之10.75。"
	},
	"I842": {
		"cls": "constants",
		"name": "琉璃灵果Ⅱ",
		"canUseItemEffect": "true",
		"text": "进阶层次的战复术，能够进行战地急救。\n战前恢复相当于对手攻防之和9.6倍的生命，并使每点护盾的效力提升为3.6倍。"
	},
	"I843": {
		"cls": "constants",
		"name": "琉璃灵果Ⅲ",
		"canUseItemEffect": "true",
		"text": "进阶层次的战复术，能够进行战地急救。\n战前恢复相当于对手攻防之和10.8倍的生命，并使每点护盾的效力提升为4.2倍。"
	},
	"I844": {
		"cls": "constants",
		"name": "琉璃灵果Ⅳ",
		"canUseItemEffect": "true",
		"text": "进阶层次的战复术，能够进行战地急救。\n战前恢复相当于对手攻防之和12.8倍的生命，并使每点护盾的效力提升为4.95倍。"
	},
	"I845": {
		"cls": "constants",
		"name": "琉璃灵果Ⅴ",
		"canUseItemEffect": "true",
		"text": "进阶层次的战复术，能够进行战地急救。\n战前恢复相当于对手攻防之和14.8倍的生命，并使每点护盾的效力提升为5.7倍。"
	},
	"I846": {
		"cls": "constants",
		"name": "琉璃灵果Max",
		"canUseItemEffect": "true",
		"text": "进阶层次的战复术，能够进行战地急救。\n战前恢复相当于对手攻防之和16.8倍的生命，并使每点护盾的效力提升为6.45倍。"
	},
	"I847": {
		"cls": "constants",
		"name": "流萤幽火Ⅱ",
		"canUseItemEffect": "true",
		"text": "流萤，幽火。一花一界，一叶一舟。\n每回合以50%的伤害发动三次攻击，并使对方每回合损失最大生命的千分之2.4，生命损失持续100回合。"
	},
	"I848": {
		"cls": "constants",
		"name": "唤雨雷暴Ⅲ",
		"canUseItemEffect": "true",
		"text": "技艺纯熟的魔导士的领悟，能影响一定范围内的天气。\n每回合以50%的伤害发动三次攻击（不受超越影响），并使对方每回合损失最大生命的千分之2.8，生命损失持续100回合。"
	},
	"I849": {
		"cls": "constants",
		"name": "唤雨雷暴Ⅳ",
		"canUseItemEffect": "true",
		"text": "技艺纯熟的魔导士的领悟，能影响一定范围内的天气。\n每回合以50%的伤害发动三次攻击（不受超越影响），并使对方每回合损失最大生命的千分之2.8，生命损失持续125回合。"
	},
	"I850": {
		"cls": "constants",
		"name": "唤雨雷暴Ⅴ",
		"canUseItemEffect": "true",
		"text": "技艺纯熟的魔导士的领悟，能影响一定范围内的天气。\n每回合以50%的伤害发动三次攻击（不受超越影响），并使对方每回合损失最大生命的千分之2.8，生命损失持续150回合。"
	},
	"I851": {
		"cls": "constants",
		"name": "唤雨雷暴Max",
		"canUseItemEffect": "true",
		"text": "技艺纯熟的魔导士的领悟，能影响一定范围内的天气。\n每回合以50%的伤害发动三次攻击（不受超越影响），并使对方每回合损失最大生命的千分之3.3，生命损失持续150回合。"
	},
	"I889": {
		"cls": "items",
		"name": "黄泉之水",
		"canUseItemEffect": "true",
		"itemEffect": "core.addItem('I658', 0.05)",
		"itemEffectTip": "，禀赋+0.05x"
	},
	"I890": {
		"cls": "items",
		"name": "潮汐之水",
		"canUseItemEffect": "true",
		"itemEffect": "core.addItem('I821', 0.05)",
		"itemEffectTip": "，能力加成+0.05x"
	},
	"I893": {
		"cls": "equips",
		"name": "绒息诀",
		"canUseItemEffect": "true",
		"text": "主修气流感知的入门吐纳术。修习后，呼吸间可捕获十米内细微震动，宛若灵猫夜行。角色全属性+25%。",
		"equip": {
			"type": 0,
			"value": {},
			"percentage": {
				"mdef": 25,
				"def": 25,
				"atk": 25
			}
		}
	},
	"I894": {
		"cls": "equips",
		"name": "石心术",
		"canUseItemEffect": "true",
		"text": "将基因原力凝聚成磐石的土系功法，牢不可破的防守之下藏三息致命杀机。角色全属性+60%。",
		"equip": {
			"type": 0,
			"value": {},
			"percentage": {
				"mdef": 60,
				"def": 60,
				"atk": 60
			}
		}
	},
	"I895": {
		"cls": "equips",
		"name": "八极灵指",
		"canUseItemEffect": "true",
		"text": "将灵力聚于指尖迸发劲力的强悍体术，看似轻柔飘忽，实则十指皆含万钧暗劲，破坏力惊人。角色全属性+110%。",
		"equip": {
			"type": 0,
			"value": {},
			"percentage": {
				"mdef": 110,
				"def": 110,
				"atk": 110
			}
		}
	},
	"I896": {
		"cls": "equips",
		"name": "金蝉九壳",
		"canUseItemEffect": "true",
		"text": "模仿蝉蜕重生的保命绝学，每褪去一层蝉衣可抵消一成伤害，九层蝉衣卸力，观月人之下难以破之。角色全属性+175%。",
		"equip": {
			"type": 0,
			"value": {},
			"percentage": {
				"mdef": 175,
				"def": 175,
				"atk": 175
			}
		}
	},
	"I897": {
		"cls": "equips",
		"name": "血织罗",
		"canUseItemEffect": "true",
		"text": "不死族攻击手段的劣化版本，操纵自身血液凝成万物的诡谲秘术，初学仅能止血疗伤，精熟者可织出血网束缚敌手，乃至施展威力强大的血爆。角色全属性*3.5。",
		"equip": {
			"type": 0,
			"value": {},
			"percentage": {
				"mdef": 250,
				"def": 250,
				"atk": 250
			}
		}
	},
	"I898": {
		"cls": "equips",
		"name": "焰海生花",
		"canUseItemEffect": "true",
		"equip": {
			"type": 0,
			"value": {},
			"percentage": {
				"mdef": 400,
				"def": 400,
				"atk": 400
			}
		},
		"text": "抽取空间之中火元素点燃庞大的火之领域，在焚烧的领域内凝出火焰莲花，绽放之时引发空间塌陷，千里之内化为乌有。角色全属性*5。"
	},
	"I899": {
		"cls": "equips",
		"name": "星宿下凡",
		"canUseItemEffect": "true",
		"text": "具现星辰轮转时的周天规律，四肢百骸沟通星辰，构筑体内阵图。大成之时，举手投足牵动陨石重力，甚可身化一颗微型行星。角色全属性*7。",
		"equip": {
			"type": 0,
			"value": {},
			"percentage": {
				"mdef": 600,
				"def": 600,
				"atk": 600
			}
		}
	},
	"I900": {
		"cls": "equips",
		"name": "海月谣",
		"canUseItemEffect": "true",
		"equip": {
			"type": 0,
			"value": {},
			"percentage": {
				"mdef": 900,
				"def": 900,
				"atk": 900
			}
		},
		"text": "如歌谣般的印诀咏起之时，沧海之力携潮汐蔓延至天际，所过之处，一切皆被重塑，如炊烟般在浪潮之下逐渐消散。角色全属性*10。"
	},
	"I901": {
		"cls": "equips",
		"name": "森罗梦域",
		"canUseItemEffect": "true",
		"equip": {
			"type": 0,
			"value": {},
			"percentage": {
				"mdef": 1400,
				"def": 1400,
				"atk": 1400
			}
		},
		"text": "唤起森罗之灵，构建一片梦幻般的领域。领域内，树木花草如精灵般舞动，柔和的光芒笼罩之处，一切在梦境中陷入沉睡，逐渐崩解，堕入真正的虚幻之中。角色全属性*15。"
	},
	"I902": {
		"cls": "items",
		"name": "绿钥匙串（四把）",
		"canUseItemEffect": "true",
		"itemEffect": "core.addItem('greenKey', 4)",
		"itemEffectTip": ",绿钥匙+4"
	},
	"I920": {
		"cls": "equips",
		"name": "灵冰髓诀",
		"canUseItemEffect": "true",
		"equip": {
			"type": 0,
			"value": {},
			"percentage": {
				"mdef": 2000,
				"def": 2000,
				"atk": 2000
			}
		},
		"text": "强者于消亡在冰川纪元的文明墓碑中参悟冰之法则，以极寒之源重塑经脉的锻体法诀。大成之时，吐息间完美冻结方圆万里。角色全属性*21。"
	},
	"I921": {
		"cls": "equips",
		"name": "山海绘卷",
		"canUseItemEffect": "true",
		"text": "以磅礴精神力勾勒出蕴含天地与山海伟力的神秘图卷，每笔勾勒都留下浩瀚山海虚影。画卷展开时自成一方世界，搬山填海，星移陆沉。角色全属性*30。",
		"equip": {
			"type": 0,
			"value": {},
			"percentage": {
				"mdef": 2900,
				"def": 2900,
				"atk": 2900
			}
		}
	},
	"I922": {
		"cls": "equips",
		"name": "白尘舞祭",
		"canUseItemEffect": "true",
		"equip": {
			"type": 0,
			"value": {},
			"percentage": {
				"mdef": 4400,
				"def": 4400,
				"atk": 4400
			}
		},
		"text": "源自宇宙宠族“白尘族”上古祈雨仪式的秘法，以万族生灵的灵韵为引跳出的祭祀舞步。舞者旋身，尘雾状的灵韵凝为实质，任何一丝都蕴含湮灭的威能，足以吞噬高悬天际的星辰。角色全属性*45。"
	},
	"I923": {
		"cls": "equips",
		"name": "蚀神式",
		"canUseItemEffect": "true",
		"equip": {
			"type": 0,
			"value": {},
			"percentage": {
				"mdef": 6900,
				"def": 6900,
				"atk": 6900
			}
		},
		"text": "仿若启明星映照着深邃的深渊，划破了那一方神秘的黑暗。符号和魔法阵交织变幻，无穷尽的力量似乎正由沉睡中被唤醒。角色全属性*70。"
	},
	"I924": {
		"cls": "equips",
		"name": "青莲种",
		"canUseItemEffect": "true",
		"text": "天生兽神留下来的残卷，蕴含着无穷尽的伟力，带领血洛大陆的荒兽族群走向强盛与繁荣。角色全属性*100。",
		"equip": {
			"type": 0,
			"value": {},
			"percentage": {
				"mdef": 9900,
				"def": 9900,
				"atk": 9900
			}
		}
	},
	"I925": {
		"cls": "equips",
		"name": "羲和驭日轮",
		"canUseItemEffect": "true",
		"text": "残卷碎片，上面印着一行小字：出色的游戏理解！可惜真正的残卷已经被我换走了，想要完整的就交出绿来！角色全属性+100%，战斗伤害-10%。",
		"equip": {
			"type": 0,
			"value": {},
			"percentage": {
				"mdef": 100,
				"def": 100,
				"atk": 100
			}
		}
	},
	"I926": {
		"cls": "equips",
		"name": "时光之圆",
		"canUseItemEffect": "true",
		"text": "与天地之间尘埃的律动产生共鸣，精神念力沟通天地能量，借由其中奥秘，衍化为自身势不可挡的念力领域。角色全属性+165%。",
		"equip": {
			"type": 0,
			"value": {},
			"percentage": {
				"mdef": 165,
				"def": 165,
				"atk": 165
			}
		}
	},
	"I927": {
		"cls": "equips",
		"name": "混沌织茧",
		"canUseItemEffect": "true",
		"text": "陨墨星一脉顶级防御秘法，以强大坚韧的灵魂力量构造出精密的灵魂之塔，保护本源命核以渡过各种极端恶劣的困局。角色全属性+200%。",
		"equip": {
			"type": 0,
			"value": {},
			"percentage": {
				"mdef": 200,
				"def": 200,
				"atk": 200
			}
		}
	},
	"I928": {
		"cls": "equips",
		"name": "入定",
		"canUseItemEffect": "true",
		"equip": {
			"type": 1,
			"value": {
				"def": 300000,
				"atk": 300000
			},
			"percentage": {
				"def": 30,
				"atk": 30
			}
		},
		"text": "思维初步脱离意识束缚，进入空想状态。攻击、防御+30万 +30%。"
	},
	"I929": {
		"cls": "equips",
		"name": "灵觉",
		"canUseItemEffect": "true",
		"text": "思维觉醒，破除所有固有的主观认知框架。攻击、防御+5000万 +70%。",
		"equip": {
			"type": 1,
			"value": {
				"def": 50000000,
				"atk": 50000000
			},
			"percentage": {
				"def": 70,
				"atk": 70
			}
		}
	},
	"I930": {
		"cls": "equips",
		"name": "五感通明Ⅰ",
		"canUseItemEffect": "true",
		"equip": {
			"type": 1,
			"value": {
				"def": 18000000000,
				"atk": 18000000000
			},
			"percentage": {
				"mdef": 110,
				"def": 110,
				"atk": 110
			}
		},
		"text": "感官挣脱限制，一窥自然现象背后的因果之链。攻击、防御+180亿 全属性+110%。"
	},
	"I931": {
		"cls": "equips",
		"name": "五感通明Ⅱ",
		"canUseItemEffect": "true",
		"text": "感官挣脱限制，一窥自然现象背后的因果之链。攻击、防御+1兆 全属性+180%。",
		"equip": {
			"type": 1,
			"value": {
				"def": 1000000000000,
				"atk": 1000000000000
			},
			"percentage": {
				"mdef": 180,
				"def": 180,
				"atk": 180
			}
		}
	},
	"I932": {
		"cls": "equips",
		"name": "火灵幻海【领域一重】",
		"canUseItemEffect": "true",
		"text": "感官挣脱限制，一窥自然现象背后的因果之链。攻击、防御+1兆 +180%。",
		"equip": {
			"type": 3,
			"value": {
				"def": 300000,
				"atk": 300000
			},
			"percentage": {
				"mdef": 30,
				"def": 8,
				"atk": 8
			}
		}
	},
	"I933": {
		"cls": "equips",
		"name": "出云落月【领域四重】",
		"canUseItemEffect": "true",
		"equip": {
			"type": 3,
			"value": {
				"def": 409600000,
				"atk": 409600000
			},
			"percentage": {
				"mdef": 50,
				"def": 30,
				"atk": 30
			}
		},
		"text": "水火元素纵横交错而成的领域。水帘之间，一袭布裙如同仙子临凡，出云之姿风华绝代；火焰灼烧，暗藏杀机凌厉，剑锋所向，斩断天际，月落星沉！\n攻击、防御+4.096亿，同时+30%，护盾+50%。"
	},
	"I934": {
		"cls": "equips",
		"name": "虚实相生Ⅰ",
		"canUseItemEffect": "true",
		"text": "思维具象化为现实投影，画中仙鹤破卷而出，梦中剑意开金裂石。攻击、防御+2000兆 全属性*4。",
		"equip": {
			"type": 1,
			"value": {
				"def": 2000000000000000,
				"atk": 2000000000000000
			},
			"percentage": {
				"mdef": 300,
				"def": 300,
				"atk": 300
			}
		}
	},
	"I935": {
		"cls": "equips",
		"name": "虚实相生Ⅱ",
		"canUseItemEffect": "true",
		"text": "水火元素纵横，形成交织的流炎之泉。水帘垂落而下，治愈的灵巧协奏着水之温和，心醉神迷；周遭炎火流转跳动，炽烈的力量燃烧起火之战意，无往不利。\n攻击、防御+7200亿，同时+75%，护盾+150%。",
		"equip": {
			"type": 3,
			"value": {
				"def": 720000000000,
				"atk": 720000000000
			},
			"percentage": {
				"mdef": 150,
				"def": 75,
				"atk": 75
			}
		}
	},
	"I936": {
		"cls": "equips",
		"name": "虚实相生Ⅲ",
		"canUseItemEffect": "true",
		"text": "水火元素纵横，形成交织的流炎之泉。水帘垂落而下，治愈的灵巧协奏着水之温和，心醉神迷；周遭炎火流转跳动，炽烈的力量燃烧起火之战意，无往不利。\n攻击、防御+4.41兆，同时+90%，护盾+180%。",
		"equip": {
			"type": 3,
			"value": {
				"def": 4410000000000,
				"atk": 4410000000000
			},
			"percentage": {
				"mdef": 180,
				"def": 90,
				"atk": 90
			}
		}
	},
	"I937": {
		"cls": "equips",
		"name": "天封火牢【初窥法则·一阶】",
		"canUseItemEffect": "true"
	},
	"I938": {
		"cls": "equips",
		"name": "出云落月【领域五重】",
		"canUseItemEffect": "true",
		"text": "水火元素纵横交错而成的领域。水帘之间，一袭布裙如同仙子临凡，出云之姿风华绝代；火焰灼烧，暗藏杀机凌厉，剑锋所向，斩断天际，月落星沉！\n攻击、防御+60.84亿，同时+45%，护盾+75%。",
		"equip": {
			"type": 3,
			"value": {
				"def": 6084000000,
				"atk": 6084000000
			},
			"percentage": {
				"mdef": 75,
				"def": 45,
				"atk": 45
			}
		}
	},
	"I939": {
		"cls": "equips",
		"name": "出云落月【领域六重】",
		"canUseItemEffect": "true",
		"text": "水火元素纵横交错而成的领域。水帘之间，一袭布裙如同仙子临凡，出云之姿风华绝代；火焰灼烧，暗藏杀机凌厉，剑锋所向，斩断天际，月落星沉！\n攻击、防御+1296亿，同时+60%，护盾+100%。",
		"equip": {
			"type": 3,
			"value": {
				"def": 129600000000,
				"atk": 129600000000
			},
			"percentage": {
				"mdef": 100,
				"def": 60,
				"atk": 60
			}
		}
	},
	"I940": {
		"cls": "equips",
		"name": "天地法理Ⅰ",
		"canUseItemEffect": "true",
		"text": "思维化为法理，一念改写天地法则，缔造本源之道。\n攻击、防御+12京，同时+200%，护盾*5。",
		"equip": {
			"type": 3,
			"value": {
				"def": 120000000000000000,
				"atk": 120000000000000000
			},
			"percentage": {
				"mdef": 400,
				"def": 200,
				"atk": 200
			}
		}
	},
	"I941": {
		"cls": "equips",
		"name": "天地法理Ⅱ",
		"canUseItemEffect": "true",
		"text": "【法则三层】绮梦交织，焰舞水裳。些许水之法则织锦的碧波之上，一朵微小的火之法则莲花含苞待放。水元素的灵动拥抱着火元素的力量。以水之柔克刚，以火之烈破敌，超脱凡俗而又和谐共生。\n"
	},
	"I942": {
		"cls": "equips",
		"name": "天地法理Ⅲ",
		"canUseItemEffect": "true",
		"text": "【法则四层】绮梦交织，焰舞水裳。充盈的水之法则织锦的碧波之上，空灵绝美的火之法则莲花悠然飘荡。水元素的灵动拥抱着火元素的力量。以水之柔克刚，以火之烈破敌，超脱凡俗而又和谐共生。\n"
	},
	"I943": {
		"cls": "equips",
		"name": "天地法理Ⅳ",
		"canUseItemEffect": "true",
		"text": "【法则一层】绮梦交织，焰舞水裳。一丝水之法则织锦的碧波之上，一片蕴含火之法则的花瓣悠然飘荡。水元素的灵动拥抱着火元素的力量。以水之柔克刚，以火之烈破敌，超脱凡俗而又和谐共生。\n攻击、防御+5000兆，同时+160%，护盾+350%。",
		"equip": {
			"type": 3,
			"value": {
				"def": 5000000000000000,
				"atk": 5000000000000000
			},
			"percentage": {
				"mdef": 350,
				"def": 160,
				"atk": 160
			}
		}
	},
	"I944": {
		"cls": "equips",
		"name": "莲落水华【法则之花】",
		"canUseItemEffect": "true",
		"text": "【法则五层】绮梦交织，焰舞水裳。充盈的水之法则织锦的碧波之上，空灵绝美的火之法则莲花悠然飘荡。水元素的灵动拥抱着火元素的力量。以水之柔克刚，以火之烈破敌，超脱凡俗而又和谐共生。\n"
	},
	"I945": {
		"cls": "constants",
		"name": "散灵之环",
		"canUseItemEffect": "true",
		"text": "祥瑞御免，家宅平安。\n使用后能够驱散身上的所有Buff效果。（快捷键F）",
		"useItemEvent": [
			{
				"type": "animate",
				"name": "water",
				"loc": "hero"
			}
		],
		"useItemEffect": "core.setFlag('s113', 0);\ncore.setFlag('s114', 0);\ncore.setFlag('s120', 0);\ncore.setFlag('s121', 0);\ncore.setFlag('s141', 0);\ncore.setFlag('s142', 0);\ncore.setFlag('s143', 0);\ncore.setFlag('s157', 0);"
	},
	"I946": {
		"cls": "equips",
		"name": "太素归源Ⅰ",
		"canUseItemEffect": "true",
		"text": "思维追溯物质本初形态，直指万道源头，打破低维视界，全知全能。攻击、防御+10.89兆，同时+105%，护盾+210%。"
	},
	"I947": {
		"cls": "equips",
		"name": "太素归源Ⅱ",
		"canUseItemEffect": "true"
	},
	"I948": {
		"cls": "equips",
		"name": "太素归源Ⅲ",
		"canUseItemEffect": "true"
	},
	"I949": {
		"cls": "equips",
		"name": "太素归源Ⅳ",
		"canUseItemEffect": "true"
	},
	"I950": {
		"cls": "equips",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I951": {
		"cls": "equips",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I952": {
		"cls": "tools",
		"name": "第二幕",
		"canUseItemEffect": "true",
		"hideInToolbox": true
	},
	"I953": {
		"cls": "tools",
		"name": "第三幕",
		"canUseItemEffect": "true",
		"hideInToolbox": true
	},
	"I954": {
		"cls": "tools",
		"name": "第四幕",
		"canUseItemEffect": "true",
		"hideInToolbox": true
	},
	"I955": {
		"cls": "tools",
		"name": "第五幕",
		"canUseItemEffect": "true",
		"hideInToolbox": true
	},
	"I956": {
		"cls": "tools",
		"name": "第六幕",
		"canUseItemEffect": "true",
		"hideInToolbox": true
	},
	"I957": {
		"cls": "tools",
		"name": "新物品",
		"canUseItemEffect": "true",
		"hideInToolbox": true
	},
	"I958": {
		"cls": "tools",
		"name": "新物品",
		"canUseItemEffect": "true",
		"hideInToolbox": true
	},
	"I959": {
		"cls": "tools",
		"name": "新物品",
		"canUseItemEffect": "true",
		"hideInToolbox": true
	},
	"I960": {
		"cls": "tools",
		"name": "新物品",
		"canUseItemEffect": "true",
		"hideInToolbox": true
	},
	"I961": {
		"cls": "tools",
		"name": "新物品",
		"canUseItemEffect": "true",
		"hideInToolbox": true
	},
	"I962": {
		"cls": "tools",
		"name": "新物品",
		"canUseItemEffect": "true",
		"hideInToolbox": true
	},
	"I963": {
		"cls": "tools",
		"name": "新物品",
		"canUseItemEffect": "true",
		"hideInToolbox": true
	},
	"I964": {
		"cls": "tools",
		"name": "新物品",
		"canUseItemEffect": "true",
		"hideInToolbox": true
	},
	"I977": {
		"cls": "equips",
		"name": "玻璃大炮",
		"canUseItemEffect": "true",
		"text": "攻击性很强却脆弱无比的炮管。\n攻击+20万，防御-5000。",
		"equip": {
			"type": 4,
			"value": {
				"def": -5000,
				"atk": 200000
			},
			"percentage": {}
		}
	},
	"I978": {
		"cls": "equips",
		"name": "十连扭蛋机",
		"canUseItemEffect": "true",
		"text": "不来一次十连试试吗？\n攻击、防御+1.5亿，护盾-3亿。",
		"equip": {
			"type": 4,
			"value": {
				"mdef": -300000000,
				"def": 150000000,
				"atk": 150000000
			},
			"percentage": {}
		}
	},
	"I979": {
		"cls": "equips",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I980": {
		"cls": "equips",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I981": {
		"cls": "equips",
		"name": "魔攻标记",
		"canUseItemEffect": "true",
		"hideInToolbox": false
	},
	"I982": {
		"cls": "constants",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I983": {
		"cls": "equips",
		"name": "苍溟界碑",
		"canUseItemEffect": "true"
	},
	"I1006": {
		"cls": "items",
		"name": "黄钥匙串",
		"canUseItemEffect": "true",
		"itemEffect": "core.addItem('yellowKey', 3)",
		"itemEffectTip": ",黄钥匙+3"
	},
	"I1007": {
		"cls": "items",
		"name": "蓝钥匙串",
		"canUseItemEffect": "true",
		"itemEffect": "core.addItem('blueKey', 3)",
		"itemEffectTip": ",蓝钥匙+3"
	},
	"I1008": {
		"cls": "items",
		"name": "红钥匙串",
		"canUseItemEffect": "true",
		"itemEffect": "core.addItem('redKey', 3)",
		"itemEffectTip": ",红钥匙+3",
		"text": "挂有3把红钥匙的钥匙串。"
	},
	"I1009": {
		"cls": "items",
		"name": "圣红补给品",
		"itemEffect": "core.status.hero.hp += core.values.greenPotion * 1024 * core.status.thisMap.ratio",
		"itemEffectTip": "，生命+${core.formatBigNumber(core.values.greenPotion * core.status.thisMap.ratio * 1024)}",
		"useItemEffect": "core.status.hero.hp += core.values.greenPotion * 1024",
		"text": "极为精纯的活泼能量，甚至有起死回生的功用。\n增加相当于8192倍红血瓶的生命。"
	},
	"I1010": {
		"cls": "items",
		"name": "圣蓝补给品",
		"itemEffect": "core.status.hero.hp += core.values.greenPotion * 4096 * core.status.thisMap.ratio",
		"itemEffectTip": "，生命+${core.formatBigNumber(core.values.greenPotion * core.status.thisMap.ratio * 4096)}",
		"useItemEffect": "core.status.hero.hp += core.values.greenPotion * 4096",
		"text": "极为精纯的活泼能量，甚至有起死回生的功用。\n增加相当于16384倍蓝血瓶的生命。"
	},
	"I1011": {
		"cls": "items",
		"name": "圣黄补给品",
		"itemEffect": "core.status.hero.hp += core.values.greenPotion * 16384 * core.status.thisMap.ratio",
		"itemEffectTip": "，生命+${core.formatBigNumber(core.values.greenPotion * core.status.thisMap.ratio * 16384)}",
		"useItemEffect": "core.status.hero.hp += core.values.greenPotion * 16384",
		"text": "极为精纯的活泼能量，甚至有起死回生的功用。\n增加相当于32768倍黄血瓶的生命。"
	},
	"I1012": {
		"cls": "items",
		"name": "圣绿补给品",
		"itemEffect": "core.status.hero.hp += core.values.greenPotion * 65536 * core.status.thisMap.ratio",
		"itemEffectTip": "，生命+${core.formatBigNumber(core.values.greenPotion * core.status.thisMap.ratio * 65536)}",
		"useItemEffect": "core.status.hero.hp += core.values.greenPotion * 65536",
		"text": "极为精纯的活泼能量，甚至有起死回生的功用。\n增加相当于65536倍绿血瓶的生命。"
	},
	"I1013": {
		"cls": "items",
		"name": "神话红宝石",
		"canUseItemEffect": "true",
		"itemEffect": "core.status.hero.atk += core.values.redGem * core.status.thisMap.ratio * 100",
		"itemEffectTip": "，攻击+${core.formatBigNumber(core.values.redGem * core.status.thisMap.ratio*100)}"
	},
	"I1014": {
		"cls": "items",
		"name": "神话蓝宝石",
		"canUseItemEffect": "true",
		"itemEffect": "core.status.hero.def += core.values.blueGem * core.status.thisMap.ratio * 100",
		"itemEffectTip": "，防御+${core.formatBigNumber(core.values.blueGem * core.status.thisMap.ratio*100)}"
	},
	"I1015": {
		"cls": "items",
		"name": "神话绿宝石",
		"canUseItemEffect": "true",
		"itemEffect": "core.status.hero.mdef += core.values.greenGem * core.status.thisMap.ratio * 100",
		"itemEffectTip": "，护盾+${core.formatBigNumber(core.values.greenGem * core.status.thisMap.ratio*100)}"
	},
	"I1016": {
		"cls": "items",
		"name": "神话黄宝石",
		"canUseItemEffect": "true",
		"itemEffect": "core.status.hero.atk += core.values.redGem * core.status.thisMap.ratio * 100;\ncore.status.hero.def += core.values.blueGem * core.status.thisMap.ratio * 100;\ncore.status.hero.mdef += core.values.greenGem * core.status.thisMap.ratio * 100;\ncore.status.hero.hp += core.values.yellowPotion * core.status.thisMap.ratio * 400;",
		"itemEffectTip": "，全属性提升"
	},
	"I1017": {
		"cls": "items",
		"name": "不朽红宝石",
		"canUseItemEffect": "true",
		"itemEffect": "core.status.hero.atk += core.values.redGem * core.status.thisMap.ratio * 200",
		"itemEffectTip": "，攻击+${core.formatBigNumber(core.values.redGem * core.status.thisMap.ratio*200)}"
	},
	"I1018": {
		"cls": "items",
		"name": "不朽蓝宝石",
		"canUseItemEffect": "true",
		"itemEffect": "core.status.hero.def += core.values.blueGem * core.status.thisMap.ratio * 200",
		"itemEffectTip": "，防御+${core.formatBigNumber(core.values.blueGem * core.status.thisMap.ratio*200)}"
	},
	"I1019": {
		"cls": "items",
		"name": "不朽绿宝石",
		"canUseItemEffect": "true",
		"itemEffect": "core.status.hero.mdef += core.values.greenGem * core.status.thisMap.ratio * 200",
		"itemEffectTip": "，护盾+${core.formatBigNumber(core.values.greenGem * core.status.thisMap.ratio*200)}"
	},
	"I1020": {
		"cls": "items",
		"name": "不朽黄宝石",
		"canUseItemEffect": "true",
		"itemEffect": "core.status.hero.atk += core.values.redGem * core.status.thisMap.ratio * 200;\ncore.status.hero.def += core.values.blueGem * core.status.thisMap.ratio * 200;\ncore.status.hero.mdef += core.values.greenGem * core.status.thisMap.ratio * 200;\ncore.status.hero.hp += core.values.yellowPotion * core.status.thisMap.ratio * 1600;",
		"itemEffectTip": "，全属性提升"
	},
	"I1021": {
		"cls": "items",
		"name": "造化红宝石",
		"canUseItemEffect": "true",
		"itemEffect": "core.status.hero.atk += core.values.redGem * core.status.thisMap.ratio * 500",
		"itemEffectTip": "，攻击+${core.formatBigNumber(core.values.redGem * core.status.thisMap.ratio*500)}"
	},
	"I1022": {
		"cls": "items",
		"name": "造化蓝宝石",
		"canUseItemEffect": "true",
		"itemEffect": "core.status.hero.def += core.values.blueGem * core.status.thisMap.ratio * 500",
		"itemEffectTip": "，防御+${core.formatBigNumber(core.values.blueGem * core.status.thisMap.ratio*500)}"
	},
	"I1023": {
		"cls": "items",
		"name": "造化绿宝石",
		"canUseItemEffect": "true",
		"itemEffect": "core.status.hero.mdef += core.values.greenGem * core.status.thisMap.ratio * 500",
		"itemEffectTip": "，护盾+${core.formatBigNumber(core.values.greenGem * core.status.thisMap.ratio*500)}"
	},
	"I1024": {
		"cls": "items",
		"name": "造化黄宝石",
		"canUseItemEffect": "true",
		"itemEffect": "core.status.hero.atk += core.values.redGem * core.status.thisMap.ratio * 500;\ncore.status.hero.def += core.values.blueGem * core.status.thisMap.ratio * 500;\ncore.status.hero.mdef += core.values.greenGem * core.status.thisMap.ratio * 500;\ncore.status.hero.hp += core.values.yellowPotion * core.status.thisMap.ratio * 16000;",
		"itemEffectTip": "，全属性提升"
	},
	"I1025": {
		"cls": "items",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I1026": {
		"cls": "constants",
		"name": "幸运数字 - 1",
		"canUseItemEffect": "true",
		"text": "幸运数字 - 1"
	},
	"I1027": {
		"cls": "constants",
		"name": "幸运数字 - 2",
		"canUseItemEffect": "true",
		"text": "幸运数字 - 2"
	},
	"I1028": {
		"cls": "items",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I1029": {
		"cls": "constants",
		"name": "幸运数字 - 4",
		"canUseItemEffect": "true",
		"text": "幸运数字 - 4"
	},
	"I1030": {
		"cls": "constants",
		"name": "幸运数字 - 5",
		"canUseItemEffect": "true",
		"text": "幸运数字 - 5"
	},
	"I1031": {
		"cls": "constants",
		"name": "幸运数字 - 6",
		"canUseItemEffect": "false",
		"text": "幸运数字 - 6"
	},
	"I1032": {
		"cls": "constants",
		"name": "幸运数字 - 7",
		"canUseItemEffect": "true",
		"text": "幸运数字 - 7（点击补充道具）",
		"useItemEvent": [
			{
				"type": "if",
				"condition": "(flag:lucky7==0)",
				"true": [
					"嗯嗯，眼力不错！我们注意到，\n这堵墙的边缘轮廓似乎淡了一点。\n而实际上这里没有墙，只有这个数字……",
					"补充了一个磁吸石。",
					{
						"type": "setValue",
						"name": "item:I732",
						"operator": "+=",
						"value": "1"
					},
					{
						"type": "setValue",
						"name": "flag:lucky7",
						"operator": "+=",
						"value": "1"
					}
				],
				"false": [
					"幸运数字没有反应了诶，怎么回事呢。"
				]
			}
		]
	},
	"I1033": {
		"cls": "items",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I1034": {
		"cls": "constants",
		"name": "幸运数字 - 9",
		"canUseItemEffect": "true",
		"text": "幸运数字 - 9"
	},
	"I1114": {
		"cls": "items",
		"name": "荒兽角",
		"canUseItemEffect": "true",
		"itemEffect": "core.status.hero.atk += 1e6",
		"itemEffectTip": "，攻击+100万"
	},
	"I1115": {
		"cls": "items",
		"name": "荒兽筋",
		"canUseItemEffect": "true",
		"itemEffect": "core.status.hero.def += 1e6",
		"itemEffectTip": "，防御+100万"
	},
	"I1116": {
		"cls": "items",
		"name": "黑爪枝丫",
		"canUseItemEffect": "true",
		"itemEffect": "core.status.hero.atk += 2e6",
		"itemEffectTip": "，攻击+200万"
	},
	"I1117": {
		"cls": "items",
		"name": "白雾枝丫",
		"canUseItemEffect": "true",
		"itemEffect": "core.status.hero.def += 2e6",
		"itemEffectTip": "，防御+200万"
	},
	"I1118": {
		"cls": "items",
		"name": "万年赤铁石",
		"canUseItemEffect": "true",
		"itemEffect": "core.status.hero.atk += 1e7",
		"itemEffectTip": "，攻击+1000万"
	},
	"I1119": {
		"cls": "items",
		"name": "万年冰山玉",
		"canUseItemEffect": "true",
		"itemEffect": "core.status.hero.def += 1e7",
		"itemEffectTip": "，防御+1000万"
	},
	"I1120": {
		"cls": "items",
		"name": "珍海圣珠",
		"canUseItemEffect": "true",
		"text": "",
		"itemEffectTip": "，命盾攻防+160京/320兆/9兆/9兆",
		"itemEffect": "core.status.hero.hp += 160e16;\ncore.status.hero.mdef += 320e12;\ncore.status.hero.atk += 9e12;\ncore.status.hero.def += 9e12;"
	},
	"I1121": {
		"cls": "items",
		"name": "血杀剑",
		"canUseItemEffect": "true",
		"itemEffect": "core.status.hero.atk += 1e8",
		"itemEffectTip": "，攻击+1亿"
	},
	"I1122": {
		"cls": "items",
		"name": "圣灵结晶",
		"canUseItemEffect": "true",
		"itemEffect": "core.status.hero.def += 2e8",
		"itemEffectTip": "，防御+2亿"
	},
	"I1123": {
		"cls": "items",
		"name": "世界树之枝丫",
		"canUseItemEffect": "true",
		"itemEffect": "core.status.hero.atk += 2e8;\ncore.status.hero.def += 2e8",
		"itemEffectTip": "，攻击、防御+2亿"
	},
	"I1124": {
		"cls": "equips",
		"name": "银霜月轮（一重）",
		"canUseItemEffect": "true",
		"text": "由216颗白水晶组合而成的念力兵器，晶莹的色泽仿佛天使之翼流落于世间，亮丽的外表下是无坚不摧的威势。攻击+520万，同时+18%。",
		"equip": {
			"type": 1,
			"value": {
				"atk": 5200000
			},
			"percentage": {
				"atk": 18
			}
		}
	},
	"I1125": {
		"cls": "equips",
		"name": "银霜月轮（二重）",
		"canUseItemEffect": "true",
		"text": "由216颗白水晶组合而成的念力兵器，晶莹的色泽仿佛天使之翼流落于世间，亮丽的外表下是无坚不摧的威势。攻击+3650万，同时+32%。",
		"equip": {
			"type": 1,
			"value": {
				"atk": 36500000
			},
			"percentage": {
				"atk": 32
			}
		}
	},
	"I1126": {
		"cls": "equips",
		"name": "银霜月轮（三重）",
		"canUseItemEffect": "true",
		"text": "由216颗白水晶组合而成的念力兵器，晶莹的色泽仿佛天使之翼流落于世间，亮丽的外表下是无坚不摧的威势。攻击+2560亿，同时+50%。",
		"equip": {
			"type": 1,
			"value": {
				"atk": 256000000000
			},
			"percentage": {
				"atk": 50
			},
			"equipEvent": [
				{
					"type": "if",
					"condition": "(flag:injc==0)",
					"true": [
						{
							"type": "if",
							"condition": "(flag:moon4==0)",
							"true": [
								{
									"type": "setValue",
									"name": "flag:moon4",
									"value": "1"
								},
								"一段剧情。"
							],
							"false": []
						}
					],
					"false": []
				}
			]
		}
	},
	"I1127": {
		"cls": "equips",
		"name": "银霜月轮（四重）",
		"canUseItemEffect": "true",
		"text": "由216颗白水晶组合而成的念力兵器，晶莹的色泽仿佛天使之翼流落于世间，亮丽的外表下是无坚不摧的威势。攻击+7.29兆，同时+63%。",
		"equip": {
			"type": 1,
			"value": {
				"atk": 7290000000000
			},
			"percentage": {
				"atk": 63
			}
		}
	},
	"I1128": {
		"cls": "constants",
		"name": "幸运数字 - A",
		"canUseItemEffect": "true",
		"text": "幸运数字 - A（点击补充道具）",
		"useItemEvent": [
			{
				"type": "if",
				"condition": "(flag:luckyA==0)",
				"true": [
					"简直是万里长征呀！\n这一次绝对是史无前例的探索难度！\n怎么样，还要不要继续收集啦？",
					"补充了五个换位标靶、\n三个破墙镐、\n一个飞行器。",
					{
						"type": "setValue",
						"name": "item:I733",
						"operator": "+=",
						"value": "5"
					},
					{
						"type": "setValue",
						"name": "item:pickaxe",
						"operator": "+=",
						"value": "3"
					},
					{
						"type": "setValue",
						"name": "item:centerFly",
						"operator": "+=",
						"value": "1"
					},
					{
						"type": "setValue",
						"name": "flag:luckyA",
						"operator": "+=",
						"value": "1"
					}
				],
				"false": [
					"幸运数字没有反应了诶，怎么回事呢。"
				]
			}
		]
	},
	"I1129": {
		"cls": "constants",
		"name": "幸运数字 - B",
		"canUseItemEffect": "true",
		"text": "幸运数字 - B（点击补充道具）",
		"useItemEvent": [
			{
				"type": "if",
				"condition": "(flag:luckyB==0)",
				"true": [
					"这样都能被找到嘛！\n到底是什么神奇回路才在拿到新道具之后，\n跑到前面两百多层来操作一下哇！",
					"补充了一个磁吸石。",
					{
						"type": "setValue",
						"name": "item:I732",
						"operator": "+=",
						"value": "1"
					},
					{
						"type": "setValue",
						"name": "flag:luckyB",
						"operator": "+=",
						"value": "1"
					}
				],
				"false": [
					"幸运数字没有反应了诶，怎么回事呢。"
				]
			}
		]
	},
	"I1130": {
		"cls": "constants",
		"name": "幸运数字 - C",
		"canUseItemEffect": "true",
		"text": "幸运数字 - C"
	},
	"I1131": {
		"cls": "constants",
		"name": "幸运数字 - D",
		"canUseItemEffect": "true",
		"text": "幸运数字 - D"
	},
	"I1132": {
		"cls": "constants",
		"name": "幸运数字 - E",
		"canUseItemEffect": "true",
		"text": "幸运数字 - E"
	},
	"I1133": {
		"cls": "items",
		"name": "",
		"canUseItemEffect": "true",
		"text": ""
	},
	"I1134": {
		"cls": "constants",
		"name": "幸运字符 - ！",
		"canUseItemEffect": "true",
		"text": "幸运字符 - ！"
	},
	"I1135": {
		"cls": "constants",
		"name": "幸运字符 - ？",
		"canUseItemEffect": "true",
		"text": "幸运字符 - ？"
	},
	"I1136": {
		"cls": "items",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I1137": {
		"cls": "constants",
		"name": "幸运字符 - +",
		"canUseItemEffect": "true",
		"text": "幸运字符 - +"
	},
	"I1138": {
		"cls": "items",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I1139": {
		"cls": "items",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I1140": {
		"cls": "items",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I1141": {
		"cls": "items",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I1142": {
		"cls": "items",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I1143": {
		"cls": "constants",
		"name": "幸运字符 - %",
		"canUseItemEffect": "true",
		"text": "幸运字符 - %"
	},
	"I1144": {
		"cls": "items",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I1145": {
		"cls": "constants",
		"name": "幸运字符 - @",
		"canUseItemEffect": "true",
		"text": "幸运字符 - @"
	},
	"I1146": {
		"cls": "items",
		"name": "黯淡红宝石",
		"canUseItemEffect": "true",
		"itemEffect": "core.status.hero.atk += core.values.redGem * core.status.thisMap.ratio * 0.2",
		"itemEffectTip": "，攻击+${core.formatBigNumber(core.values.redGem * core.status.thisMap.ratio*0.2)}"
	},
	"I1147": {
		"cls": "items",
		"name": "黯淡蓝宝石",
		"canUseItemEffect": "true",
		"itemEffect": "core.status.hero.def += core.values.blueGem * core.status.thisMap.ratio * 0.2",
		"itemEffectTip": "，防御+${core.formatBigNumber(core.values.blueGem * core.status.thisMap.ratio*0.2)}"
	},
	"I1148": {
		"cls": "items",
		"name": "黯淡绿宝石",
		"canUseItemEffect": "true",
		"itemEffectTip": "，护盾+${core.formatBigNumber(core.values.greenGem * core.status.thisMap.ratio*0.2)}",
		"itemEffect": "core.status.hero.mdef += core.values.greenGem * core.status.thisMap.ratio * 0.2"
	},
	"I1149": {
		"cls": "items",
		"name": "黯淡黄宝石",
		"canUseItemEffect": "true",
		"itemEffect": "core.status.hero.atk += core.values.redGem * core.status.thisMap.ratio * 0.2;\ncore.status.hero.def += core.values.blueGem * core.status.thisMap.ratio * 0.2;\ncore.status.hero.mdef += core.values.greenGem * core.status.thisMap.ratio * 0.2;\ncore.status.hero.hp += core.values.yellowPotion * core.status.thisMap.ratio * 0.2;",
		"itemEffectTip": "，全属性提升"
	},
	"I1150": {
		"cls": "items",
		"name": "混沌神石·红",
		"canUseItemEffect": "true"
	},
	"I1151": {
		"cls": "items",
		"name": "混沌神石·蓝",
		"canUseItemEffect": "true"
	},
	"I1152": {
		"cls": "items",
		"name": "混沌神石·黄",
		"canUseItemEffect": "true",
		"itemEffect": "core.status.hero.atk += core.values.redGem * core.status.thisMap.ratio * 5000;\ncore.status.hero.def += core.values.blueGem * core.status.thisMap.ratio * 5000;\ncore.status.hero.mdef += core.values.greenGem * core.status.thisMap.ratio * 5000;\ncore.status.hero.hp += core.values.yellowPotion * core.status.thisMap.ratio * 16384000;"
	},
	"I1153": {
		"cls": "items",
		"name": "混沌神石·绿",
		"canUseItemEffect": "true"
	},
	"I1154": {
		"cls": "items",
		"name": "神灵天水",
		"canUseItemEffect": "true"
	},
	"I1155": {
		"cls": "items",
		"name": "神圣天水",
		"canUseItemEffect": "true"
	},
	"I1156": {
		"cls": "items",
		"name": "法则灵水",
		"canUseItemEffect": "true"
	},
	"I1157": {
		"cls": "items",
		"name": "法则圣水",
		"canUseItemEffect": "true"
	},
	"I1158": {
		"cls": "items",
		"name": "神眷·红",
		"canUseItemEffect": null,
		"useItemEffect": "core.status.hero.hp += core.values.greenPotion * 67108864",
		"itemEffectTip": "，生命+${core.formatBigNumber(core.values.greenPotion * core.status.thisMap.ratio * 67108864)}",
		"itemEffect": "core.status.hero.hp += core.values.greenPotion * 67108864 * core.status.thisMap.ratio"
	},
	"I1159": {
		"cls": "items",
		"name": "神眷·蓝",
		"canUseItemEffect": null,
		"useItemEffect": "core.status.hero.hp += core.values.greenPotion * 268435456",
		"itemEffectTip": "，生命+${core.formatBigNumber(core.values.greenPotion * core.status.thisMap.ratio * 268435456)}",
		"itemEffect": "core.status.hero.hp += core.values.greenPotion * 268435456 * core.status.thisMap.ratio"
	},
	"I1160": {
		"cls": "items",
		"name": "神眷·黄",
		"canUseItemEffect": null,
		"useItemEffect": "core.status.hero.hp += core.values.greenPotion * 1073741824",
		"itemEffectTip": "，生命+${core.formatBigNumber(core.values.greenPotion * core.status.thisMap.ratio * 1073741824)}",
		"itemEffect": "core.status.hero.hp += core.values.greenPotion * 1073741824 * core.status.thisMap.ratio"
	},
	"I1161": {
		"cls": "items",
		"name": "神眷·绿",
		"canUseItemEffect": null,
		"useItemEffect": "core.status.hero.hp += core.values.greenPotion * 4294967296",
		"itemEffectTip": "，生命+${core.formatBigNumber(core.values.greenPotion * core.status.thisMap.ratio * 4294967296)}",
		"itemEffect": "core.status.hero.hp += core.values.greenPotion * 4294967296 * core.status.thisMap.ratio"
	},
	"I1162": {
		"cls": "items",
		"name": "永恒神石·红",
		"canUseItemEffect": "true"
	},
	"I1163": {
		"cls": "items",
		"name": "永恒神石·蓝",
		"canUseItemEffect": "true"
	},
	"I1164": {
		"cls": "items",
		"name": "永恒神石·黄",
		"canUseItemEffect": "true",
		"itemEffect": "core.status.hero.atk += core.values.redGem * core.status.thisMap.ratio * 10000;\ncore.status.hero.def += core.values.blueGem * core.status.thisMap.ratio * 10000;\ncore.status.hero.mdef += core.values.greenGem * core.status.thisMap.ratio * 10000;\ncore.status.hero.hp += core.values.yellowPotion * core.status.thisMap.ratio * 2621440000;"
	},
	"I1165": {
		"cls": "items",
		"name": "永恒神石·绿",
		"canUseItemEffect": "true"
	},
	"I1166": {
		"cls": "items",
		"name": "神乞·红",
		"canUseItemEffect": null,
		"useItemEffect": "core.status.hero.hp += core.values.greenPotion * 17179869184",
		"itemEffectTip": "，生命+${core.formatBigNumber(core.values.greenPotion * core.status.thisMap.ratio * 17179869184)}",
		"itemEffect": "core.status.hero.hp += core.values.greenPotion * 17179869184 * core.status.thisMap.ratio"
	},
	"I1167": {
		"cls": "items",
		"name": "神乞·蓝",
		"canUseItemEffect": null,
		"useItemEffect": "core.status.hero.hp += core.values.greenPotion * 68719476736",
		"itemEffectTip": "，生命+${core.formatBigNumber(core.values.greenPotion * core.status.thisMap.ratio * 68719476736)}",
		"itemEffect": "core.status.hero.hp += core.values.greenPotion * 68719476736 * core.status.thisMap.ratio"
	},
	"I1168": {
		"cls": "items",
		"name": "神乞·黄",
		"canUseItemEffect": null,
		"useItemEffect": "core.status.hero.hp += core.values.greenPotion * 274877906944",
		"itemEffectTip": "，生命+${core.formatBigNumber(core.values.greenPotion * core.status.thisMap.ratio * 274877906944)}",
		"itemEffect": "core.status.hero.hp += core.values.greenPotion * 274877906944 * core.status.thisMap.ratio"
	},
	"I1169": {
		"cls": "items",
		"name": "神乞·绿",
		"canUseItemEffect": null,
		"useItemEffect": "core.status.hero.hp += core.values.greenPotion * 1099511627776",
		"itemEffectTip": "，生命+${core.formatBigNumber(core.values.greenPotion * core.status.thisMap.ratio * 1099511627776)}",
		"itemEffect": "core.status.hero.hp += core.values.greenPotion * 1099511627776 * core.status.thisMap.ratio"
	},
	"I1170": {
		"cls": "items",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I1171": {
		"cls": "items",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I1172": {
		"cls": "items",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I1173": {
		"cls": "items",
		"name": "清音凤羽",
		"canUseItemEffect": "true",
		"itemEffect": "core.status.hero.atk += 4e11;\ncore.status.hero.def += 4e11",
		"itemEffectTip": "，攻击、防御+4000亿"
	},
	"I1174": {
		"cls": "items",
		"name": "魈的赏赐",
		"canUseItemEffect": "true",
		"itemEffect": "core.status.hero.hp += 4e16;\ncore.status.hero.mdef += 40e12;\ncore.status.hero.atk += 2e11;\ncore.status.hero.def += 2e11;",
		"itemEffectTip": "，生命+4京、护盾+40兆、攻防+2000亿"
	},
	"I1175": {
		"cls": "equips",
		"name": "银褐星石残片",
		"canUseItemEffect": "true",
		"text": "造价昂贵的E9级飞船“大智者级”报废肢解后得到的破片，其铸造材料为下位F级金属“银褐星石”，即使一小块也让界主强者趋之若鹜。\n攻击、防御+80兆。",
		"equip": {
			"type": 4,
			"value": {
				"def": 80000000000000,
				"atk": 80000000000000
			},
			"percentage": {}
		}
	},
	"I1176": {
		"cls": "items",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I1177": {
		"cls": "items",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I1178": {
		"cls": "equips",
		"name": "陨墨九诀（小成）",
		"canUseItemEffect": "true",
		"text": "陨墨星一脉精神念力修炼方法。凝、韧、散、锐、柔、刚、舞、幻、融，九诀小成后，精神念力凝练至无比坚韧，无懈可击。攻击、防御+2兆，护盾*5。",
		"equip": {
			"type": 5,
			"value": {
				"def": 2000000000000,
				"atk": 2000000000000
			},
			"percentage": {
				"mdef": 400
			}
		}
	},
	"I1179": {
		"cls": "tools",
		"name": "驭龙泉",
		"canUseItemEffect": "false",
		"text": "深藏于远古龙脉之底，为万纪元前驭使古龙的不朽神灵陨落时所留的气息所滋养，蕴含至纯至净的驭龙之力的奇异泉水。\n每个可抵御【古龙奥利维尔】1%的伤害。"
	},
	"I1180": {
		"cls": "items",
		"name": "零之翼",
		"canUseItemEffect": "true",
		"itemEffect": "core.status.hero.atk += 7e11;\ncore.status.hero.def += 1.4e12",
		"itemEffectTip": "，攻击+7000亿、防御+1.4兆"
	},
	"I1181": {
		"cls": "equips",
		"name": "逆命棱镜",
		"canUseItemEffect": "true",
		"text": "诞生于天地秘境之中的神异D级金属，蕴含一丝空间元素，通过扭曲空间以吸收来袭的力量，足以化解域主之下绝大多数的攻势。防御+4096亿，同时+20%；魔防+30兆，同时+40%。",
		"equip": {
			"type": 2,
			"value": {
				"mdef": 30000000000000,
				"def": 409600000000
			},
			"percentage": {
				"mdef": 40,
				"def": 20
			}
		}
	},
	"I1182": {
		"cls": "constants",
		"name": "标志物：心境",
		"canUseItemEffect": "true",
		"text": "诶……你正在进行心境挑战呢。加油！"
	},
	"I1183": {
		"cls": "items",
		"name": "灰魇庭花",
		"canUseItemEffect": "true",
		"itemEffect": "core.status.hero.atk += 1.5e12;\ncore.status.hero.def += 1.5e12",
		"itemEffectTip": "，攻击+1.5兆、防御+1.5兆"
	},
	"I1184": {
		"cls": "items",
		"name": "黄钥匙盒",
		"canUseItemEffect": "true",
		"itemEffect": "core.addItem('yellowKey', 9)",
		"itemEffectTip": ",黄钥匙+9",
		"text": "装有9把黄钥匙的小盒子。"
	},
	"I1185": {
		"cls": "items",
		"name": "蓝钥匙盒",
		"canUseItemEffect": "true",
		"itemEffect": "core.addItem('blueKey', 9)",
		"itemEffectTip": ",蓝钥匙+9",
		"text": "装有9把蓝钥匙的小盒子。"
	},
	"I1186": {
		"cls": "items",
		"name": "红钥匙盒",
		"canUseItemEffect": "true",
		"text": "装有9把红钥匙的小盒子。",
		"itemEffect": "core.addItem('redKey', 9)",
		"itemEffectTip": ",红钥匙+9"
	},
	"I1187": {
		"cls": "tools",
		"name": "心境之石",
		"canUseItemEffect": "true",
		"useItemEvent": [
			{
				"type": "function",
				"function": "function(){\ncore.addItem('I1187', 1);\n}"
			},
			{
				"type": "choices",
				"text": "确定要使用心境之石吗？",
				"choices": [
					{
						"text": "已经无法再继续了，我需要使用。",
						"color": [
							64,
							179,
							233,
							1
						],
						"action": [
							{
								"type": "setValue",
								"name": "item:I1187",
								"operator": "-=",
								"value": "1"
							},
							{
								"type": "animate",
								"name": "jidi",
								"loc": "hero"
							},
							{
								"type": "setValue",
								"name": "status:hp",
								"operator": "*=",
								"value": "1.5"
							},
							{
								"type": "setValue",
								"name": "status:atk",
								"operator": "*=",
								"value": "1.1"
							},
							{
								"type": "setValue",
								"name": "status:def",
								"operator": "*=",
								"value": "1.1"
							},
							{
								"type": "setValue",
								"name": "status:mdef",
								"operator": "*=",
								"value": "1.1"
							},
							"使用成功！\n你的生命增加了一半，\n三围属性增加了10%。\n同时，作为代价，你的分数变为之前的1%。",
							{
								"type": "if",
								"condition": "(flag:xun==0)",
								"true": [
									"检测到当前为首次使用心境之石，\n你将获得最大程度的难度降幅，\n因此付出的分数代价为十倍。",
									{
										"type": "setValue",
										"name": "flag:xun",
										"value": "1000"
									}
								],
								"false": [
									{
										"type": "setValue",
										"name": "flag:xun",
										"operator": "*=",
										"value": "100"
									}
								]
							},
							{
								"type": "if",
								"condition": "(item:I1187==0)",
								"true": [
									"你居然用掉了所有的心境之石！\n恭喜触发特殊的奖励，请查看背包。",
									{
										"type": "setValue",
										"name": "item:I1418",
										"operator": "+=",
										"value": "1"
									}
								],
								"false": []
							}
						]
					},
					{
						"text": "还可以……坚持一下。",
						"color": [
							239,
							219,
							111,
							1
						],
						"action": []
					}
				]
			}
		],
		"text": "看起来只是一块不太普通的石头。\n使用后生命+50%，三围属性+10%，分数变为1%。（首次使用代价十倍）"
	},
	"I1418": {
		"cls": "constants",
		"name": "标志物：咸",
		"canUseItemEffect": "true",
		"text": "你的心境之石用得太多了！\n现在游戏变成走路模拟器了。"
	},
	"I1419": {
		"cls": "items",
		"name": "创世神石·红",
		"canUseItemEffect": "true"
	},
	"I1420": {
		"cls": "items",
		"name": "创世神石·蓝",
		"canUseItemEffect": "true"
	},
	"I1421": {
		"cls": "items",
		"name": "创世神石·黄",
		"canUseItemEffect": "true",
		"itemEffect": "core.status.hero.atk += core.values.redGem * core.status.thisMap.ratio * 20000;\ncore.status.hero.def += core.values.blueGem * core.status.thisMap.ratio * 20000;\ncore.status.hero.mdef += core.values.greenGem * core.status.thisMap.ratio * 20000;\ncore.status.hero.hp += core.values.yellowPotion * core.status.thisMap.ratio * 41943040000;"
	},
	"I1422": {
		"cls": "items",
		"name": "创世神石·绿",
		"canUseItemEffect": "true"
	},
	"I1423": {
		"cls": "items",
		"name": "奇迹红宝石",
		"canUseItemEffect": "true",
		"itemEffect": "core.status.hero.atk += core.values.redGem * core.status.thisMap.ratio * 1000",
		"itemEffectTip": "，攻击+${core.formatBigNumber(core.values.redGem * core.status.thisMap.ratio*1000)}"
	},
	"I1424": {
		"cls": "items",
		"name": "奇迹蓝宝石",
		"canUseItemEffect": "true",
		"itemEffect": "core.status.hero.def += core.values.blueGem * core.status.thisMap.ratio * 1000",
		"itemEffectTip": "，防御+${core.formatBigNumber(core.values.blueGem * core.status.thisMap.ratio*1000)}"
	},
	"I1425": {
		"cls": "items",
		"name": "奇迹绿宝石",
		"canUseItemEffect": "true",
		"itemEffect": "core.status.hero.mdef += core.values.greenGem * core.status.thisMap.ratio * 1000",
		"itemEffectTip": "，护盾+${core.formatBigNumber(core.values.greenGem * core.status.thisMap.ratio*1000)}"
	},
	"I1426": {
		"cls": "items",
		"name": "奇迹黄宝石",
		"canUseItemEffect": "true",
		"itemEffect": "core.status.hero.atk += core.values.redGem * core.status.thisMap.ratio * 1000;\ncore.status.hero.def += core.values.blueGem * core.status.thisMap.ratio * 1000;\ncore.status.hero.mdef += core.values.greenGem * core.status.thisMap.ratio * 1000;\ncore.status.hero.hp += core.values.yellowPotion * core.status.thisMap.ratio * 128000;"
	},
	"I1427": {
		"cls": "items",
		"name": null,
		"canUseItemEffect": "true",
		"text": null
	},
	"I1428": {
		"cls": "items",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I1429": {
		"cls": "items",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I1430": {
		"cls": "items",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I1431": {
		"cls": "equips",
		"name": "概念具现Ⅰ",
		"canUseItemEffect": "true",
		"text": "使所思所想的一切抽象概念——哲学悖论、神级文明公式……化作实体形态。攻击、防御+10.89兆，同时+105%，护盾+210%。"
	},
	"I1432": {
		"cls": "equips",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I1433": {
		"cls": "equips",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I1434": {
		"cls": "equips",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I1435": {
		"cls": "equips",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I1436": {
		"cls": "equips",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I1437": {
		"cls": "items",
		"name": "次级领悟之灵",
		"canUseItemEffect": "true",
		"itemEffect": "core.status.hero.money += 100",
		"itemEffectTip": "，领悟+100",
		"text": "天地间充沛的能量滋养诞生的光球，\n接触后能够化作海量的领悟为人所用。\n角色增加100领悟。"
	},
	"I1438": {
		"cls": "items",
		"name": "初级领悟之灵",
		"canUseItemEffect": "true",
		"text": "天地间充沛的能量滋养诞生的光球，\n接触后能够化作海量的领悟为人所用。\n角色增加1000领悟。",
		"itemEffect": "core.status.hero.money += 1000",
		"itemEffectTip": "，领悟+1000"
	},
	"I1439": {
		"cls": "items",
		"name": "中级领悟之灵",
		"canUseItemEffect": "true",
		"itemEffect": "core.status.hero.money += 10000",
		"itemEffectTip": "，领悟+10000",
		"text": "天地间充沛的能量滋养诞生的光球，\n接触后能够化作海量的领悟为人所用。\n角色增加10000领悟。"
	},
	"I1440": {
		"cls": "items",
		"name": "高级领悟之灵",
		"canUseItemEffect": "true"
	},
	"I1441": {
		"cls": "items",
		"name": "绽放的领悟之灵",
		"canUseItemEffect": "true"
	},
	"I1442": {
		"cls": "items",
		"name": "闪耀的领悟之灵",
		"canUseItemEffect": "true"
	},
	"I1443": {
		"cls": "items",
		"name": "圣洁的领悟之灵",
		"canUseItemEffect": "true"
	},
	"I1444": {
		"cls": "items",
		"name": "史诗的领悟之灵",
		"canUseItemEffect": "true"
	},
	"I1445": {
		"cls": "items",
		"name": "传说的领悟之灵",
		"canUseItemEffect": "true"
	},
	"I1446": {
		"cls": "items",
		"name": "神话的领悟之灵",
		"canUseItemEffect": "true"
	},
	"I1447": {
		"cls": "items",
		"name": "不朽的领悟之灵",
		"canUseItemEffect": "true"
	},
	"I1448": {
		"cls": "items",
		"name": "奇迹的领悟之灵",
		"canUseItemEffect": "true"
	},
	"I1449": {
		"cls": "equips",
		"name": "天织套装",
		"canUseItemEffect": "true",
		"text": "采用E级金属打造，附着得自植物生命天织花的绸缎材料，柔韧而坚劲，融合十种基础元素护罩，可根据战斗需要进行灵活调整。\n防御+9.6兆，同时+48%。",
		"equip": {
			"type": 2,
			"value": {
				"def": 9600000000000
			},
			"percentage": {
				"def": 48
			}
		}
	},
	"I1450": {
		"cls": "items",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I1451": {
		"cls": "items",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I1452": {
		"cls": "items",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I1453": {
		"cls": "items",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I1454": {
		"cls": "items",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I1455": {
		"cls": "items",
		"name": "行道者的通行证",
		"canUseItemEffect": "true",
		"itemEffectTip": "，生命+600京，攻击、防御+20兆",
		"itemEffect": "core.status.hero.hp += 600e16;\ncore.status.hero.atk += 20e12;\ncore.status.hero.def += 20e12;"
	},
	"I1456": {
		"cls": "items",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I1457": {
		"cls": "items",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I1458": {
		"cls": "items",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I1459": {
		"cls": "items",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I1460": {
		"cls": "items",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I1461": {
		"cls": "items",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I1462": {
		"cls": "items",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I1463": {
		"cls": "items",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I1464": {
		"cls": "items",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I1465": {
		"cls": "items",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I1466": {
		"cls": "items",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I1467": {
		"cls": "items",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I1468": {
		"cls": "items",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I1469": {
		"cls": "items",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I1470": {
		"cls": "items",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I1471": {
		"cls": "items",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I1472": {
		"cls": "items",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I1473": {
		"cls": "constants",
		"name": "驱散之戒（假）",
		"canUseItemEffect": "true"
	},
	"I1474": {
		"cls": "items",
		"name": "高阶道具黑箱",
		"canUseItemEffect": "true",
		"text": "带有珍贵物品标志箱子，里面装了大量道具。\n打开后获得红、破、飞、吸、换各四。",
		"itemEffect": "core.addItem('redKey', 4)\ncore.addItem('pickaxe', 4)\ncore.addItem('centerFly', 4)\ncore.addItem('I732', 4)\ncore.addItem('I733', 4)",
		"itemEffectTip": ",全道具+4"
	},
	"I1475": {
		"cls": "items",
		"name": "道具黑箱",
		"canUseItemEffect": "true",
		"text": "不明金属所制的箱子，里面装了一整套道具。\n打开后获得红、破、飞、吸、换各一。",
		"itemEffect": "core.addItem('redKey', 1)\ncore.addItem('pickaxe', 1)\ncore.addItem('centerFly', 1)\ncore.addItem('I732', 1)\ncore.addItem('I733', 1)",
		"itemEffectTip": ",全道具+1"
	},
	"I1476": {
		"cls": "equips",
		"name": "星震卷轴",
		"canUseItemEffect": "true",
		"text": "威力庞大而造型奇特的卷轴状物，蕴含足以引发一颗生命星球物种大灭绝的能量。\n攻击+5.6兆，防御+4兆。",
		"equip": {
			"type": 4,
			"value": {
				"def": 4000000000000,
				"atk": 5600000000000
			},
			"percentage": {}
		}
	},
	"I1477": {
		"cls": "items",
		"name": "新物品",
		"canUseItemEffect": "true",
		"useItemEvent": [
			{
				"type": "autoSave"
			},
			{
				"type": "playSound",
				"name": "heart.mp3"
			},
			{
				"type": "animate",
				"name": "buff",
				"loc": [
					8,
					7
				],
				"async": true
			},
			{
				"type": "function",
				"function": "function(){\ncore.replaceBlock(81, 83);\n}"
			},
			{
				"type": "function",
				"function": "function(){\ncore.replaceBlock(82, 83);\n}"
			},
			{
				"type": "function",
				"function": "function(){\ncore.replaceBlock(85, 454);\n}"
			},
			{
				"type": "function",
				"function": "function(){\ncore.replaceBlock(86, 109);\n}"
			},
			{
				"type": "function",
				"function": "function(){\ncore.replaceBlock(28, 27);\n}"
			},
			{
				"type": "function",
				"function": "function(){\ncore.replaceBlock(21,23);\n}"
			},
			{
				"type": "function",
				"function": "function(){\ncore.replaceBlock(22, 23);\n}"
			},
			{
				"type": "function",
				"function": "function(){\ncore.replaceBlock(32, 31);\n}"
			},
			{
				"type": "function",
				"function": "function(){\ncore.replaceBlock(1, 110);\n}"
			},
			{
				"type": "function",
				"function": "function(){\ncore.replaceBlock(4, 111);\n}"
			},
			{
				"type": "setFloor",
				"name": "defaultGround",
				"value": "grass"
			},
			{
				"type": "function",
				"function": "function(){\ncore.drawMap()\n}"
			},
			{
				"type": "waitAsync"
			}
		]
	},
	"I1478": {
		"cls": "constants",
		"name": "幸运箭头 - ↑",
		"canUseItemEffect": "true",
		"text": "幸运箭头 - ↑"
	},
	"I1479": {
		"cls": "constants",
		"name": "幸运箭头 - ↓",
		"canUseItemEffect": "true",
		"text": "幸运箭头 - ↓"
	},
	"I1480": {
		"cls": "constants",
		"name": "幸运箭头 - ←",
		"canUseItemEffect": "true",
		"text": "幸运箭头 - ←"
	},
	"I1481": {
		"cls": "items",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I1482": {
		"cls": "constants",
		"name": "幸运箭头 - ∧",
		"canUseItemEffect": "true",
		"text": "幸运箭头 - ∧"
	},
	"I1483": {
		"cls": "items",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I1484": {
		"cls": "items",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I1485": {
		"cls": "items",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I1486": {
		"cls": "items",
		"name": "仙红补给品",
		"canUseItemEffect": null,
		"itemEffect": "core.status.hero.hp += core.values.greenPotion * 262144 * core.status.thisMap.ratio",
		"itemEffectTip": "，生命+${core.formatBigNumber(core.values.greenPotion * core.status.thisMap.ratio * 262144)}",
		"useItemEffect": "core.status.hero.hp += core.values.greenPotion * 262144"
	},
	"I1487": {
		"cls": "items",
		"name": "仙蓝补给品",
		"canUseItemEffect": null,
		"itemEffect": "core.status.hero.hp += core.values.greenPotion * 1048576 * core.status.thisMap.ratio",
		"itemEffectTip": "，生命+${core.formatBigNumber(core.values.greenPotion * core.status.thisMap.ratio * 1048576)}",
		"useItemEffect": "core.status.hero.hp += core.values.greenPotion * 1048576"
	},
	"I1488": {
		"cls": "items",
		"name": "仙黄补给品",
		"useItemEffect": "core.status.hero.hp += core.values.greenPotion * 4194304",
		"itemEffectTip": "，生命+${core.formatBigNumber(core.values.greenPotion * core.status.thisMap.ratio * 4194304)}",
		"itemEffect": "core.status.hero.hp += core.values.greenPotion * 4194304 * core.status.thisMap.ratio"
	},
	"I1489": {
		"cls": "items",
		"name": "仙绿补给品",
		"canUseItemEffect": null,
		"useItemEffect": "core.status.hero.hp += core.values.greenPotion * 16777216",
		"itemEffectTip": "，生命+${core.formatBigNumber(core.values.greenPotion * core.status.thisMap.ratio * 16777216)}",
		"itemEffect": "core.status.hero.hp += core.values.greenPotion * 16777216 * core.status.thisMap.ratio"
	},
	"I1490": {
		"cls": "items",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I1491": {
		"cls": "constants",
		"name": "一丝水火法则感悟",
		"canUseItemEffect": "true",
		"text": "一丝水火法则感悟。\n将护盾的千分之三加在攻防上。"
	},
	"I1492": {
		"cls": "constants",
		"name": "迈入水火法则门槛",
		"canUseItemEffect": "true",
		"text": "迈入水火法则门槛。\n将护盾的千分之六加在攻防上。"
	},
	"I1493": {
		"cls": "constants",
		"name": "初成水火法则感悟",
		"canUseItemEffect": "true",
		"text": "水火法则感悟已经初成。（领悟后，“迈入水火法则门槛”将消失）\n将护盾的百分之一加在攻防上，且每次攻击附带千分之一的魔攻。",
		"useItemEvent": null
	},
	"I1494": {
		"cls": "equips",
		"name": "时光殿（未知）",
		"canUseItemEffect": "true",
		"text": "？？？",
		"equip": {
			"type": 5,
			"value": {},
			"percentage": {}
		}
	},
	"I1495": {
		"cls": "items",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I1697": {
		"cls": "equips",
		"name": "银霜月轮（圆满）",
		"canUseItemEffect": "true",
		"text": "由216颗白水晶组合而成的念力兵器，晶莹的色泽仿佛天使之翼流落于世间，亮丽的外表下是无坚不摧的威势。攻击+52.9兆，同时+80%。",
		"equip": {
			"type": 1,
			"value": {
				"atk": 52900000000000
			},
			"percentage": {
				"atk": 80
			}
		}
	},
	"I1698": {
		"cls": "items",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I1699": {
		"cls": "equips",
		"name": "九线流",
		"canUseItemEffect": "true",
		"text": "精神念师飞行秘法《万线流》第二层，似乎在天外族群的不朽神灵之中流传很广的秘术，蕴含空间的道与理，足以对照感悟空间本源法则。身法大成，可现万千幻身，臻至瞬移之境。角色全属性+255%。",
		"equip": {
			"type": 0,
			"value": {},
			"percentage": {
				"mdef": 255,
				"def": 255,
				"atk": 255
			}
		}
	},
	"I1700": {
		"cls": "equips",
		"name": "兽神残卷（三阶小成）",
		"canUseItemEffect": "true",
		"equip": {
			"type": 0,
			"value": {},
			"percentage": {
				"mdef": 165,
				"def": 165,
				"atk": 165
			}
		},
		"text": "天生兽神留下来的残卷，蕴含着无穷尽的伟力，带领血洛大陆的荒兽族群走向强盛与繁荣。角色全属性+165%，战斗伤害-40%。"
	},
	"I1701": {
		"cls": "equips",
		"name": "兽神残卷（三阶大成）",
		"canUseItemEffect": "true",
		"equip": {
			"type": 0,
			"value": {},
			"percentage": {
				"mdef": 200,
				"def": 200,
				"atk": 200
			}
		},
		"text": "天生兽神留下来的残卷，蕴含着无穷尽的伟力，带领血洛大陆的荒兽族群走向强盛与繁荣。角色全属性+200%，战斗伤害-40%。"
	},
	"I1702": {
		"cls": "equips",
		"name": "兽神残卷（三阶圆满）",
		"canUseItemEffect": "true",
		"equip": {
			"type": 0,
			"value": {},
			"percentage": {
				"mdef": 255,
				"def": 255,
				"atk": 255
			}
		},
		"text": "天生兽神留下来的残卷，蕴含着无穷尽的伟力，带领血洛大陆的荒兽族群走向强盛与繁荣。角色全属性+255%，战斗伤害-40%。"
	},
	"I1703": {
		"cls": "equips",
		"name": "兽神残卷（四阶初成）",
		"canUseItemEffect": "true",
		"equip": {
			"type": 0,
			"value": {},
			"percentage": {
				"mdef": 320,
				"def": 320,
				"atk": 320
			}
		},
		"text": "天生兽神留下来的残卷，蕴含着无穷尽的伟力，带领血洛大陆的荒兽族群走向强盛与繁荣。角色全属性+320%，战斗伤害-40%。"
	},
	"I1704": {
		"cls": "equips",
		"name": "兽神残卷（四阶小成）",
		"canUseItemEffect": "true",
		"equip": {
			"type": 0,
			"value": {},
			"percentage": {
				"mdef": 400,
				"def": 400,
				"atk": 400
			}
		},
		"text": "天生兽神留下来的残卷，蕴含着无穷尽的伟力，带领血洛大陆的荒兽族群走向强盛与繁荣。角色全属性*5，战斗伤害-40%。"
	},
	"I1705": {
		"cls": "equips",
		"name": "兽神残卷（四阶大成）",
		"canUseItemEffect": "true",
		"equip": {
			"type": 0,
			"value": {},
			"percentage": {
				"mdef": 500,
				"def": 500,
				"atk": 500
			}
		},
		"text": "天生兽神留下来的残卷，蕴含着无穷尽的伟力，带领血洛大陆的荒兽族群走向强盛与繁荣。角色全属性*6，战斗伤害-40%。"
	},
	"I1706": {
		"cls": "equips",
		"name": "兽神残卷（四阶圆满）",
		"canUseItemEffect": "true",
		"text": "天生兽神留下来的残卷，蕴含着无穷尽的伟力，带领血洛大陆的荒兽族群走向强盛与繁荣。角色全属性*7.5，战斗伤害-40%。",
		"equip": {
			"type": 0,
			"value": {},
			"percentage": {
				"mdef": 650,
				"def": 650,
				"atk": 650
			}
		}
	},
	"I1707": {
		"cls": "equips",
		"name": "兽神残卷（四阶极致）",
		"canUseItemEffect": "true",
		"text": "天生兽神留下来的残卷，蕴含着无穷尽的伟力，带领血洛大陆的荒兽族群走向强盛与繁荣。角色全属性*9，战斗伤害-40%。",
		"equip": {
			"type": 0,
			"value": {},
			"percentage": {
				"mdef": 800,
				"def": 800,
				"atk": 800
			}
		}
	},
	"I1708": {
		"cls": "equips",
		"name": "二色灵诀",
		"canUseItemEffect": "true",
		"text": "由巅峰强者“灵淼仙子”所创造的一门心诀，以水、火感悟为基，将两种法则的平衡与调和臻至极致，直指本源，形成神异独特的“二色灵力”，万物化生，演化出千变万化的术式。角色全属性*5。",
		"equip": {
			"type": 0,
			"value": {},
			"percentage": {
				"mdef": 400,
				"def": 400,
				"atk": 400
			}
		}
	},
	"I1709": {
		"cls": "equips",
		"name": "虚空之塔（四层）",
		"canUseItemEffect": "true",
		"text": "陨墨星一脉顶级防御秘法，以强大坚韧的灵魂力量构造出精密的灵魂之塔，保护本源命核以渡过各种极端恶劣的困局。角色全属性+320%。",
		"equip": {
			"type": 0,
			"value": {},
			"percentage": {
				"mdef": 320,
				"def": 320,
				"atk": 320
			}
		}
	},
	"I1710": {
		"cls": "equips",
		"name": "虚空之塔（五层）",
		"canUseItemEffect": "true"
	},
	"I1711": {
		"cls": "equips",
		"name": "百线流",
		"canUseItemEffect": "true",
		"text": "精神念师飞行秘法《万线流》第三层，似乎在天外族群的不朽神灵之中流传很广的秘术，蕴含空间的道与理，足以对照感悟空间本源法则。身法大成，可现万千幻身，臻至瞬移之境。角色全属性*6。",
		"equip": {
			"type": 0,
			"value": {},
			"percentage": {
				"mdef": 500,
				"def": 500,
				"atk": 500
			}
		}
	},
	"I1712": {
		"cls": "equips",
		"name": "洛神九变",
		"canUseItemEffect": "true"
	},
	"I1713": {
		"cls": "items",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I1714": {
		"cls": "items",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I1715": {
		"cls": "items",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I1716": {
		"cls": "items",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I1717": {
		"cls": "items",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I1718": {
		"cls": "items",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I1719": {
		"cls": "items",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I1720": {
		"cls": "items",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I1721": {
		"cls": "items",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I1722": {
		"cls": "items",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I1723": {
		"cls": "equips",
		"name": "闭月炎泉【领域极致】",
		"canUseItemEffect": "true",
		"text": "水火元素纵横，形成交织的流炎之泉。水帘垂落而下，治愈的灵巧协奏着水之温和，心醉神迷；周遭炎火流转跳动，炽烈的力量燃烧起火之战意，无往不利。\n攻击、防御+77.44兆，同时+120%，护盾+240%。",
		"equip": {
			"type": 3,
			"value": {
				"def": 77440000000000,
				"atk": 77440000000000
			},
			"percentage": {
				"mdef": 240,
				"def": 120,
				"atk": 120
			}
		}
	},
	"I1724": {
		"cls": "items",
		"name": "莲落水华【法则果实】",
		"canUseItemEffect": "true"
	},
	"I1725": {
		"cls": "items",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I1726": {
		"cls": "items",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I1727": {
		"cls": "items",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I1728": {
		"cls": "equips",
		"name": "悖论奇点Ⅰ",
		"canUseItemEffect": "true",
		"text": "思维超脱概念本身，非想非非想，非有非非有。存在本身即为悖论，行走之处一切契合现实与非现实之逻辑的事物崩溃。"
	},
	"I1729": {
		"cls": "items",
		"name": "悖论奇点Ⅹ",
		"canUseItemEffect": "true"
	},
	"I1730": {
		"cls": "items",
		"name": "悖论奇点↑",
		"canUseItemEffect": "true"
	},
	"I1731": {
		"cls": "items",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I1732": {
		"cls": "items",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I1733": {
		"cls": "items",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I1734": {
		"cls": "items",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I1735": {
		"cls": "items",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I1736": {
		"cls": "items",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I1737": {
		"cls": "items",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I1738": {
		"cls": "items",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I1739": {
		"cls": "items",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I1740": {
		"cls": "equips",
		"name": "时光殿（未启）",
		"canUseItemEffect": "true",
		"text": "？？？\n角色全属性+50%。",
		"equip": {
			"type": 5,
			"value": {},
			"percentage": {
				"mdef": 50,
				"def": 50,
				"atk": 50
			}
		}
	},
	"I1741": {
		"cls": "items",
		"name": "原始神石·红",
		"canUseItemEffect": "true",
		"itemEffect": "core.status.hero.atk += core.values.redGem * core.status.thisMap.ratio * 10000",
		"itemEffectTip": "，攻击+${core.formatBigNumber(core.values.redGem * core.status.thisMap.ratio*10000)}"
	},
	"I1742": {
		"cls": "items",
		"name": "原始神石·蓝",
		"canUseItemEffect": "true",
		"itemEffect": "core.status.hero.def += core.values.blueGem * core.status.thisMap.ratio * 10000",
		"itemEffectTip": "，防御+${core.formatBigNumber(core.values.blueGem * core.status.thisMap.ratio*10000)}"
	},
	"I1743": {
		"cls": "items",
		"name": "原始神石·绿",
		"canUseItemEffect": "true"
	},
	"I1744": {
		"cls": "items",
		"name": "原始神石·黄",
		"canUseItemEffect": "true"
	},
	"I1745": {
		"cls": "items",
		"name": "上位神石·红",
		"canUseItemEffect": "true",
		"itemEffect": "core.status.hero.atk += core.values.redGem * core.status.thisMap.ratio * 20000",
		"itemEffectTip": "，攻击+${core.formatBigNumber(core.values.redGem * core.status.thisMap.ratio*20000}"
	},
	"I1746": {
		"cls": "items",
		"name": "上位神石·蓝",
		"canUseItemEffect": "true",
		"itemEffect": "core.status.hero.def += core.values.blueGem * core.status.thisMap.ratio * 20000",
		"itemEffectTip": "，防御+${core.formatBigNumber(core.values.blueGem * core.status.thisMap.ratio*20000}"
	},
	"I1747": {
		"cls": "items",
		"name": "上位神石·绿",
		"canUseItemEffect": "true"
	},
	"I1748": {
		"cls": "items",
		"name": "上位神石·黄",
		"canUseItemEffect": "true"
	},
	"I1749": {
		"cls": "items",
		"name": "冒险者的补给",
		"canUseItemEffect": "true",
		"itemEffectTip": "，生命+5000京、护盾+2京",
		"itemEffect": "core.status.hero.hp += 5000e16;\ncore.status.hero.mdef += 2e16;"
	},
	"I1750": {
		"cls": "items",
		"name": "红桦叶",
		"canUseItemEffect": "true",
		"itemEffectTip": "，攻击、防御+100兆",
		"itemEffect": "core.status.hero.atk += 100e12;\ncore.status.hero.def += 100e12;"
	},
	"I1751": {
		"cls": "items",
		"name": "红色血魔凝晶",
		"canUseItemEffect": "true",
		"itemEffectTip": "，攻击+500兆",
		"itemEffect": "core.status.hero.atk += 500e12;"
	},
	"I1752": {
		"cls": "items",
		"name": "蓝色血魔凝晶",
		"canUseItemEffect": "true",
		"itemEffect": "core.status.hero.def += 500e12;",
		"itemEffectTip": "，防御+500兆"
	},
	"I1753": {
		"cls": "items",
		"name": "燃尽荆棘之刺",
		"canUseItemEffect": "true",
		"itemEffectTip": "，攻击+900兆、防御+300兆",
		"itemEffect": "core.status.hero.atk += 900e12;\ncore.status.hero.def += 300e12;"
	},
	"I1754": {
		"cls": "items",
		"name": "燃尽火海之星",
		"canUseItemEffect": "true",
		"itemEffectTip": "，攻击+300兆、防御+900兆",
		"itemEffect": "core.status.hero.atk += 300e12;\ncore.status.hero.def += 900e12;"
	},
	"I1755": {
		"cls": "items",
		"name": "葬地万年寒果",
		"canUseItemEffect": "true",
		"itemEffectTip": "，攻击、防御+1320兆、护盾+10京",
		"itemEffect": "core.status.hero.atk += 1320e12;\ncore.status.hero.def += 1320e12;\ncore.status.hero.mdef += 10e16;"
	},
	"I1756": {
		"cls": "items",
		"name": "古神的颂歌·红",
		"canUseItemEffect": "true",
		"itemEffect": "core.status.hero.hp += core.values.greenPotion * 1099511627776 * core.status.thisMap.ratio"
	},
	"I1757": {
		"cls": "items",
		"name": "古神的颂歌·蓝",
		"canUseItemEffect": "true"
	},
	"I1758": {
		"cls": "items",
		"name": "古神的颂歌·黄",
		"canUseItemEffect": "true"
	},
	"I1759": {
		"cls": "items",
		"name": "古神的颂歌·绿",
		"canUseItemEffect": "true"
	},
	"I1760": {
		"cls": "items",
		"name": "『冗律』铁剑",
		"canUseItemEffect": "true",
		"itemEffect": "core.status.hero.atk += 5000e12;",
		"itemEffectTip": "，攻击+5000兆"
	},
	"I1761": {
		"cls": "items",
		"name": "『冗律』银剑",
		"canUseItemEffect": "true",
		"itemEffect": "core.status.hero.atk += 1e16;",
		"itemEffectTip": "，攻击+1京"
	},
	"I1762": {
		"cls": "items",
		"name": "『冗律』圣剑",
		"canUseItemEffect": "true",
		"itemEffect": "core.status.hero.atk += 2e16;",
		"itemEffectTip": "，攻击+2京"
	},
	"I1763": {
		"cls": "items",
		"name": "『冗律』铁盾",
		"canUseItemEffect": "true",
		"itemEffect": "core.status.hero.def += 5000e12;",
		"itemEffectTip": "，防御+5000兆"
	},
	"I1764": {
		"cls": "items",
		"name": "『冗律』银盾",
		"canUseItemEffect": "true",
		"itemEffect": "core.status.hero.def += 1e16;",
		"itemEffectTip": "，防御+1京"
	},
	"I1765": {
		"cls": "items",
		"name": "『冗律』圣盾",
		"canUseItemEffect": "true",
		"itemEffect": "core.status.hero.def += 2e16;",
		"itemEffectTip": "，防御+2京"
	},
	"I1766": {
		"cls": "items",
		"name": "缥缈音魂",
		"canUseItemEffect": "true",
		"itemEffect": "core.status.hero.hp += 400e20;",
		"itemEffectTip": "，生命+400垓"
	},
	"I1767": {
		"cls": "items",
		"name": "啸啸风叶",
		"canUseItemEffect": "true",
		"itemEffectTip": "，攻击+5000兆",
		"itemEffect": "core.status.hero.atk += 5000e12;"
	},
	"I1768": {
		"cls": "items",
		"name": "幻心镜",
		"canUseItemEffect": "true",
		"itemEffectTip": "，防御+5000兆",
		"itemEffect": "core.status.hero.def += 5000e12;"
	},
	"I1769": {
		"cls": "items",
		"name": "纯白八音盒",
		"canUseItemEffect": "true",
		"itemEffect": "core.status.hero.def += 4e16;",
		"itemEffectTip": "，防御+4京"
	},
	"I1770": {
		"cls": "items",
		"name": "燃翼长琴",
		"canUseItemEffect": "true",
		"itemEffect": "core.status.hero.atk += 4e16;",
		"itemEffectTip": "，攻击+4京"
	},
	"I1771": {
		"cls": "items",
		"name": "天使之翼徽",
		"canUseItemEffect": "true",
		"itemEffect": "core.status.hero.atk += 10e16;",
		"itemEffectTip": "，攻击+10京"
	},
	"I1772": {
		"cls": "items",
		"name": "调和弦六角章",
		"canUseItemEffect": "true",
		"itemEffect": "core.status.hero.def += 10e16;",
		"itemEffectTip": "，防御+10京"
	},
	"I1773": {
		"cls": "equips",
		"name": "洛神兵·惊鸿",
		"canUseItemEffect": "true",
		"text": "掌控者九大神兵之一，由10081枚银、玉二色的重水结晶构成的弓形神兵。尾族巅峰存在“澪一”于绝地【洛水】的一次异象中，捕捉到自然协和之水，与原始空寂之空间协奏的微妙韵律，诞生的智慧结晶，堪称水、空法则的巅峰之作。当前为第一重。（武器）\n攻击+5京，同时+135%。",
		"equip": {
			"type": 1,
			"value": {
				"atk": 50000000000000000
			},
			"percentage": {
				"atk": 135
			}
		}
	},
	"I1774": {
		"cls": "items",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I1775": {
		"cls": "items",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I1776": {
		"cls": "equips",
		"name": "遁影烛",
		"canUseItemEffect": "true",
		"text": "由机缘巧合下诞生的某种珍奇灵材炼制而成，外表似蜡烛，表面散发着淡淡的蕴含空间本源法则的荧光，可令持有者身形无影无踪，非神灵不可寻踪迹。（特殊）\n角色全属性+80%，战斗伤害*0.9。",
		"equip": {
			"type": 5,
			"value": {},
			"percentage": {
				"mdef": 80,
				"def": 80,
				"atk": 80
			}
		}
	},
	"I1777": {
		"cls": "items",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I1778": {
		"cls": "items",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I1779": {
		"cls": "items",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I1780": {
		"cls": "items",
		"name": "岩灵巨力果",
		"canUseItemEffect": "true",
		"text": "生长于致密岩石行星的内核之中，火、空元素最为浓郁之处，表面覆盖着粗糙而坚硬的石质外壳，带有淡淡的土壤、矿石与果香混合的气息，服用可以提升火空法则的亲和度。\n立即增加12.5京基础攻击、防御。",
		"itemEffectTip": "，攻击、防御+12.5京",
		"itemEffect": "core.status.hero.atk += 125e15;\ncore.status.hero.def += 125e15;"
	},
	"I1781": {
		"cls": "equips",
		"name": "起源之章",
		"canUseItemEffect": "true",
		"text": "某位伟大炼器师使用F级金属制成的纹章，雕刻着蕴含宇宙间八大法则最原始、纯粹的符文与图案。通过对其研读与感悟，曾有强者一路问鼎，打遍不朽之下无敌手，所向披靡。（器械）\n基础攻击、防御+32京，同时+30%，基础护盾-144京。",
		"equip": {
			"type": 4,
			"value": {
				"mdef": -1440000000000000000,
				"def": 320000000000000000,
				"atk": 320000000000000000
			},
			"percentage": {
				"def": 30,
				"atk": 30
			}
		}
	},
	"I1782": {
		"cls": "equips",
		"name": "芊缈叶·域初",
		"canUseItemEffect": "true",
		"text": "享有盛誉而又非常稀有的植物生命，以“生态恢复”的能力而著称，能够汲取环境中的负面能量与有害物质，转化为滋养自身的生命精华，并释放出净化光环，为宿主生命提供庇护。当前培养阶段为领域级初期，进化标志在于其叶片脉络与纹理的复杂度。（防具）防御+90%，护盾+150%。",
		"equip": {
			"type": 2,
			"value": {},
			"percentage": {
				"mdef": 150,
				"def": 90
			}
		}
	},
	"I1783": {
		"cls": "items",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I1784": {
		"cls": "items",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I1785": {
		"cls": "items",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I1786": {
		"cls": "items",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I1787": {
		"cls": "items",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I1788": {
		"cls": "tools",
		"name": "一倍领悟获取速度",
		"canUseItemEffect": "true",
		"hideInToolbox": true,
		"text": "这枚彩色的、画着古怪笑脸的金币……似乎代表着每次战斗中领悟法则的速度。"
	},
	"I1789": {
		"cls": "equips",
		"name": "洛神兵·游龙",
		"canUseItemEffect": "true",
		"text": "掌控者九大神兵之一，由10081枚银、玉二色的重水结晶构成的弓形神兵。尾族巅峰存在“澪一”于绝地【洛水】的一次异象中，捕捉到自然协和之水，与原始空寂之空间协奏的微妙韵律，诞生的智慧结晶，堪称水、空法则的巅峰之作。当前为第二重。（武器）\n攻击+49京，同时+180%。",
		"equip": {
			"type": 1,
			"value": {
				"atk": 490000000000000000
			},
			"percentage": {
				"atk": 180
			}
		}
	},
	"I1790": {
		"cls": "equips",
		"name": "洛神兵·轻云",
		"canUseItemEffect": "true"
	},
	"I1791": {
		"cls": "equips",
		"name": "洛神兵·蔽月",
		"canUseItemEffect": "true"
	},
	"I1792": {
		"cls": "equips",
		"name": "洛神兵·流风",
		"canUseItemEffect": "true"
	},
	"I1793": {
		"cls": "equips",
		"name": "洛神兵·回雪",
		"canUseItemEffect": "true"
	},
	"I1794": {
		"cls": "equips",
		"name": "洛神兵·凌波步",
		"canUseItemEffect": "true"
	},
	"I1795": {
		"cls": "equips",
		"name": "洛神兵·若幽兰",
		"canUseItemEffect": "true"
	},
	"I1796": {
		"cls": "equips",
		"name": "洛神兵·怅神宵",
		"canUseItemEffect": "true"
	},
	"I1797": {
		"cls": "equips",
		"name": "陨墨九诀（大成）",
		"canUseItemEffect": "true",
		"text": "陨墨星一脉精神念力修炼方法。凝、韧、散、锐、柔、刚、舞、幻、融，九诀大成，精神念力变化无穷，各种复杂的攻坚手段信手拈来，甚至能够洞察到同阶对手的情绪与意图，从而在战斗中占据先机。攻击、防御+9000兆，护盾*8。",
		"equip": {
			"type": 5,
			"value": {
				"def": 9000000000000000,
				"atk": 9000000000000000
			},
			"percentage": {
				"mdef": 700
			}
		}
	},
	"I2070": {
		"cls": "items",
		"name": "流窜的亡灵",
		"canUseItemEffect": "true",
		"itemEffectTip": "，塔中亡灵+5",
		"itemEffect": "core.addFlag('wl', 5)"
	},
	"I2071": {
		"cls": "items",
		"name": "聚集的亡灵",
		"canUseItemEffect": "true",
		"itemEffectTip": "，塔中亡灵+25",
		"itemEffect": "core.addFlag('wl', 25)"
	},
	"I2072": {
		"cls": "items",
		"name": "凝华的亡灵",
		"canUseItemEffect": "true",
		"itemEffectTip": "，塔中亡灵+150",
		"itemEffect": "core.addFlag('wl', 150)"
	},
	"I2073": {
		"cls": "items",
		"name": "幻神之石·红",
		"canUseItemEffect": "true",
		"itemEffect": "core.status.hero.atk += core.values.redGem * core.status.thisMap.ratio * 2000",
		"itemEffectTip": "，攻击+${core.formatBigNumber(core.values.redGem * core.status.thisMap.ratio*2000)}"
	},
	"I2074": {
		"cls": "items",
		"name": "幻神之石·蓝",
		"canUseItemEffect": "true",
		"itemEffect": "core.status.hero.def += core.values.blueGem * core.status.thisMap.ratio * 2000",
		"itemEffectTip": "，防御+${core.formatBigNumber(core.values.blueGem * core.status.thisMap.ratio*2000)}"
	},
	"I2075": {
		"cls": "items",
		"name": "幻神之石·绿",
		"canUseItemEffect": "true",
		"itemEffect": "core.status.hero.mdef += core.values.greenGem * core.status.thisMap.ratio * 2000",
		"itemEffectTip": "，护盾+${core.formatBigNumber(core.values.greenGem * core.status.thisMap.ratio*2000)}"
	},
	"I2076": {
		"cls": "items",
		"name": "幻神之石·黄",
		"canUseItemEffect": "true"
	},
	"I2077": {
		"cls": "items",
		"name": "神赐·红",
		"canUseItemEffect": "true"
	},
	"I2078": {
		"cls": "items",
		"name": "神赐·蓝",
		"canUseItemEffect": "true"
	},
	"I2079": {
		"cls": "items",
		"name": "神赐·黄",
		"canUseItemEffect": "true"
	},
	"I2080": {
		"cls": "items",
		"name": "神赐·绿",
		"canUseItemEffect": "true"
	},
	"I2081": {
		"cls": "items",
		"name": "古神·遗泽[红]",
		"canUseItemEffect": "true"
	},
	"I2082": {
		"cls": "items",
		"name": "古神·遗泽[蓝]",
		"canUseItemEffect": "true"
	},
	"I2083": {
		"cls": "items",
		"name": "古神·遗泽[绿]",
		"canUseItemEffect": "true"
	},
	"I2084": {
		"cls": "items",
		"name": "古神·遗泽[黄]",
		"canUseItemEffect": "true"
	},
	"I2085": {
		"cls": "items",
		"name": "古神·轮回[红]",
		"canUseItemEffect": "true"
	},
	"I2086": {
		"cls": "items",
		"name": "古神·轮回[蓝]",
		"canUseItemEffect": "true"
	},
	"I2087": {
		"cls": "items",
		"name": "古神·轮回[绿]",
		"canUseItemEffect": "true"
	},
	"I2088": {
		"cls": "items",
		"name": "古神·轮回[黄]",
		"canUseItemEffect": "true"
	},
	"I2089": {
		"cls": "items",
		"name": "生命？",
		"canUseItemEffect": "true"
	},
	"I2090": {
		"cls": "items",
		"name": "黯淡的进化结晶",
		"canUseItemEffect": "true",
		"itemEffect": "core.status.hero.exp += 50",
		"itemEffectTip": "，经验+50"
	},
	"I2091": {
		"cls": "items",
		"name": "黯淡的高等结晶",
		"canUseItemEffect": "true",
		"itemEffect": "core.status.hero.exp += 50000",
		"itemEffectTip": "，经验+5万"
	},
	"I2092": {
		"cls": "items",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I2093": {
		"cls": "items",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I2094": {
		"cls": "items",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I2095": {
		"cls": "items",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I2096": {
		"cls": "items",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I2097": {
		"cls": "items",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I2098": {
		"cls": "items",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I2099": {
		"cls": "items",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I2100": {
		"cls": "items",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I2101": {
		"cls": "items",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I2102": {
		"cls": "items",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I2103": {
		"cls": "items",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I2104": {
		"cls": "items",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I2105": {
		"cls": "items",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I2106": {
		"cls": "items",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I2107": {
		"cls": "items",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I2108": {
		"cls": "items",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I2109": {
		"cls": "items",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I2110": {
		"cls": "items",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I2111": {
		"cls": "items",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I2112": {
		"cls": "items",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I2113": {
		"cls": "items",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I2114": {
		"cls": "items",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I2115": {
		"cls": "items",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I2116": {
		"cls": "items",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I2117": {
		"cls": "items",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I2118": {
		"cls": "items",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I2119": {
		"cls": "items",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I2120": {
		"cls": "items",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I2121": {
		"cls": "items",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I2122": {
		"cls": "items",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I2123": {
		"cls": "items",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I2124": {
		"cls": "items",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I2125": {
		"cls": "items",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I2126": {
		"cls": "items",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I2127": {
		"cls": "items",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I2128": {
		"cls": "items",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I2129": {
		"cls": "items",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I2130": {
		"cls": "items",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I2131": {
		"cls": "items",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I2132": {
		"cls": "items",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I2133": {
		"cls": "items",
		"name": "新物品",
		"canUseItemEffect": "true"
	}
}
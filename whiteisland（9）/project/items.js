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
		"text": "红色的晶体，可以强化自己的力量。\n攻击+${core.values.redGem * core.status.thisMap.ratio}。",
		"itemEffect": "core.status.hero.atk += core.values.redGem * core.status.thisMap.ratio",
		"itemEffectTip": "，攻击+${core.values.redGem * core.status.thisMap.ratio}",
		"useItemEffect": "core.status.hero.atk += core.values.redGem",
		"canUseItemEffect": "true"
	},
	"blueGem": {
		"cls": "items",
		"name": "初始蓝宝石",
		"text": "蓝色的晶体，可以使自己更加灵巧。\n防御+${core.values.blueGem * core.status.thisMap.ratio}。",
		"itemEffect": "core.status.hero.def += core.values.blueGem * core.status.thisMap.ratio",
		"itemEffectTip": "，防御+${core.values.blueGem * core.status.thisMap.ratio}",
		"useItemEffect": "core.status.hero.def += core.values.blueGem",
		"canUseItemEffect": "true"
	},
	"greenGem": {
		"cls": "items",
		"name": "初始绿宝石",
		"text": "绿色的晶体，可以吸收受到的伤害。\n护盾+${core.values.greenGem * core.status.thisMap.ratio}。",
		"itemEffect": "core.status.hero.mdef += core.values.greenGem * core.status.thisMap.ratio",
		"itemEffectTip": "，护盾+${core.values.greenGem * core.status.thisMap.ratio}",
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
		"text": "飘散在空气中的活泼能量的具现化，能够恢复生命。\n生命+${core.values.redPotion}。",
		"itemEffect": "core.status.hero.hp += core.values.redPotion * core.status.thisMap.ratio",
		"itemEffectTip": "，生命+${core.values.redPotion * core.status.thisMap.ratio}",
		"useItemEffect": "core.status.hero.hp += core.values.redPotion",
		"canUseItemEffect": "true"
	},
	"bluePotion": {
		"cls": "items",
		"name": "蓝色补给品",
		"text": "飘散在空气中的活泼能量的具现化，能够恢复生命。\n生命+${core.values.bluePotion}。",
		"itemEffect": "core.status.hero.hp += core.values.bluePotion * core.status.thisMap.ratio",
		"itemEffectTip": "，生命+${core.values.bluePotion * core.status.thisMap.ratio}",
		"useItemEffect": "core.status.hero.hp += core.values.bluePotion",
		"canUseItemEffect": "true"
	},
	"yellowPotion": {
		"cls": "items",
		"name": "黄色补给品",
		"text": "飘散在空气中的活泼能量的具现化，能够恢复生命。\n生命+${core.values.yellowPotion}。",
		"itemEffect": "core.status.hero.hp += core.values.yellowPotion * core.status.thisMap.ratio",
		"itemEffectTip": "，生命+${core.values.yellowPotion * core.status.thisMap.ratio}",
		"useItemEffect": "core.status.hero.hp += core.values.yellowPotion",
		"canUseItemEffect": "true"
	},
	"greenPotion": {
		"cls": "items",
		"name": "绿色补给品",
		"text": "飘散在空气中的活泼能量的具现化，能够恢复生命。\n生命+${core.values.greenPotion}。",
		"itemEffect": "core.status.hero.hp += core.values.greenPotion * core.status.thisMap.ratio",
		"itemEffectTip": "，生命+${core.values.greenPotion * core.status.thisMap.ratio}",
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
		"canUseItemEffect": "(function () {\n\tif (core.flags.flyNearStair && !core.nearStair()) return false;\n\treturn core.status.maps[core.status.floorId].canFlyFrom;\n})();"
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
		"text": "可以破坏面前的小型障碍物",
		"useItemEffect": "(function () {\n\tvar canBreak = function (x, y) {\n\t\tvar block = core.getBlock(x, y);\n\t\tif (block == null || block.disable) return false;\n\t\treturn block.event.canBreak;\n\t};\n\n\tvar success = false;\n\tvar pickaxeFourDirections = false; // 是否多方向破；如果是将其改成true\n\tif (pickaxeFourDirections) {\n\t\t// 多方向破\n\t\tfor (var direction in core.utils.scan) { // 多方向破默认四方向，如需改成八方向请将这两个scan改为scan2\n\t\t\tvar delta = core.utils.scan[direction];\n\t\t\tvar nx = core.getHeroLoc('x') + delta.x,\n\t\t\t\tny = core.getHeroLoc('y') + delta.y;\n\t\t\tif (canBreak(nx, ny)) {\n\t\t\t\tcore.removeBlock(nx, ny);\n\t\t\t\tsuccess = true;\n\t\t\t}\n\t\t}\n\t} else {\n\t\t// 仅破当前\n\t\tif (canBreak(core.nextX(), core.nextY())) {\n\t\t\tcore.removeBlock(core.nextX(), core.nextY());\n\t\t\tsuccess = true;\n\t\t}\n\t}\n\n\tif (success) {\n\t\tcore.playSound('破墙镐');\n\t\tcore.drawTip(core.material.items[itemId].name + '使用成功', itemId);\n\t} else {\n\t\t// 无法使用\n\t\tcore.playSound('操作失败');\n\t\tcore.drawTip(\"当前无法使用\" + core.material.items[itemId].name, itemId);\n\t\tcore.addItem(itemId, 1);\n\t\treturn;\n\t}\n})();",
		"canUseItemEffect": "true"
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
		"text": "可以飞向当前楼层中心对称的位置",
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
		"itemEffectTip": "，生命+${core.values.greenPotion * core.status.thisMap.ratio * 2}"
	},
	"weakWine": {
		"cls": "items",
		"name": "大蓝补给品",
		"text": "浓郁的活泼能量，能使伤口快速愈合。\n增加相当于16倍蓝血瓶的生命。",
		"useItemEffect": "core.status.hero.hp += core.values.greenPotion * 4",
		"canUseItemEffect": true,
		"itemEffect": "core.status.hero.hp += core.values.greenPotion * 4 * core.status.thisMap.ratio",
		"itemEffectTip": "，生命+${core.values.greenPotion * core.status.thisMap.ratio * 4}"
	},
	"curseWine": {
		"cls": "items",
		"name": "大绿补给品",
		"text": "浓郁的活泼能量，能使伤口快速愈合。\n增加相当于16倍绿血瓶的生命。",
		"useItemEffect": "core.status.hero.hp += core.values.greenPotion * 16",
		"canUseItemEffect": null,
		"itemEffect": "core.status.hero.hp += core.values.greenPotion * 16 * core.status.thisMap.ratio",
		"itemEffectTip": "，生命+${core.values.greenPotion * core.status.thisMap.ratio * 16}"
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
		"name": "新物品",
		"canUseItemEffect": "true"
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
		"itemEffectTip": "，生命+${core.values.greenPotion * core.status.thisMap.ratio * 8}",
		"useItemEffect": "core.status.hero.hp += core.values.greenPotion * 8",
		"text": "浓郁的活泼能量，能使伤口快速愈合。\n增加相当于16倍黄血瓶的生命"
	},
	"I573": {
		"cls": "items",
		"name": "新物品",
		"canUseItemEffect": "true"
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
		"itemEffectTip": "，攻击+${core.values.redGem * core.status.thisMap.ratio*2}",
		"text": "高阶红色晶体，可以更大化强化自己的力量。\n直接增加2倍于普通红宝石的攻击力。"
	},
	"I577": {
		"cls": "items",
		"name": "高阶蓝宝石",
		"itemEffect": "core.status.hero.def += core.values.blueGem * core.status.thisMap.ratio*2",
		"itemEffectTip": "，防御+${core.values.blueGem * core.status.thisMap.ratio*2}",
		"text": "高阶蓝色晶体，可以更大化使自己更加灵巧。\n直接增加2倍于普通蓝宝石的防御力。"
	},
	"I578": {
		"cls": "items",
		"name": "高阶绿宝石",
		"itemEffect": "core.status.hero.mdef += core.values.greenGem * core.status.thisMap.ratio*2",
		"itemEffectTip": "，护盾+${core.values.greenGem * core.status.thisMap.ratio*2}",
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
		"text": "伤害减免50%，血瓶效力增加30%。"
	},
	"I582": {
		"cls": "constants",
		"name": "Rank：Easy",
		"canUseItemEffect": "true",
		"text": "伤害减免10%。"
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
		"itemEffectTip": "，攻击+${core.values.redGem * core.status.thisMap.ratio*5}",
		"text": "极为珍贵的红色晶体，能够使体质产生不小的变化。\n直接增加5倍于普通红宝石的攻击力。"
	},
	"I585": {
		"cls": "items",
		"name": "极品蓝宝石",
		"itemEffect": "core.status.hero.def += core.values.blueGem * core.status.thisMap.ratio*5",
		"itemEffectTip": "，防御+${core.values.blueGem * core.status.thisMap.ratio*5}",
		"text": "极为珍贵的蓝色晶体，能够使自身变得轻盈如燕。\n直接增加5倍于普通蓝宝石的防御力。"
	},
	"I586": {
		"cls": "items",
		"name": "极品绿宝石",
		"itemEffect": "core.status.hero.mdef += core.values.greenGem * core.status.thisMap.ratio*5",
		"itemEffectTip": "，护盾+${core.values.greenGem * core.status.thisMap.ratio*5}",
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
		"name": "自动拾取开关",
		"canUseItemEffect": "true",
		"text": "一个奇怪的标识，好像…可以转动？",
		"useItemEvent": [
			{
				"type": "choices",
				"text": "这里是自动拾取开关！\n为了更流畅的体验，\n建议只在最高难度的少数情况下关闭它。",
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
		"cls": "items",
		"name": "新物品",
		"canUseItemEffect": "true"
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
		"cls": "items",
		"name": "新物品",
		"canUseItemEffect": "true"
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
		"name": "地宫剑",
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
		"name": "森林剑",
		"canUseItemEffect": "true",
		"itemEffect": "core.status.hero.atk += 1500",
		"itemEffectTip": "，攻击+1500"
	},
	"I613": {
		"cls": "items",
		"name": "灰暗剑",
		"canUseItemEffect": "true",
		"itemEffect": "core.status.hero.atk += 500",
		"itemEffectTip": "，攻击+500"
	},
	"I614": {
		"cls": "items",
		"name": "家主佩剑（二阶）",
		"canUseItemEffect": "true",
		"itemEffect": "core.status.hero.atk += 20",
		"itemEffectTip": "，攻击+20"
	},
	"I615": {
		"cls": "items",
		"name": "家主佩剑",
		"canUseItemEffect": "true",
		"text": "天然的空心石块打造的剑。\n攻击+6000。",
		"equip": {
			"type": "装备",
			"value": {
				"atk": 6000
			},
			"percentage": {}
		},
		"itemEffect": "core.status.hero.atk += 8",
		"itemEffectTip": "，攻击+8"
	},
	"I616": {
		"cls": "items",
		"name": "家主佩剑（三阶）",
		"canUseItemEffect": "true",
		"itemEffect": "core.status.hero.atk += 100",
		"itemEffectTip": "，攻击+100"
	},
	"I617": {
		"cls": "items",
		"name": "天青长剑",
		"canUseItemEffect": "true",
		"itemEffect": "core.status.hero.atk += 10000",
		"itemEffectTip": "，攻击+10000"
	},
	"I618": {
		"cls": "items",
		"name": "焚风长剑",
		"canUseItemEffect": "true",
		"itemEffect": "core.status.hero.atk += 30000",
		"itemEffectTip": "，攻击+30000"
	},
	"I619": {
		"cls": "items",
		"name": "超红补给品",
		"itemEffect": "core.status.hero.hp += core.values.greenPotion * 32 * core.status.thisMap.ratio",
		"itemEffectTip": "，生命+${core.values.greenPotion * core.status.thisMap.ratio * 32}",
		"useItemEffect": "core.status.hero.hp += core.values.greenPotion * 32",
		"text": "极为精纯的活泼能量，甚至有起死回生的功用。\n增加相当于256倍红血瓶的生命。"
	},
	"I620": {
		"cls": "items",
		"name": "超蓝补给品",
		"itemEffect": "core.status.hero.hp += core.values.greenPotion * 64 * core.status.thisMap.ratio",
		"itemEffectTip": "，生命+${core.values.greenPotion * core.status.thisMap.ratio * 64}",
		"useItemEffect": "core.status.hero.hp += core.values.greenPotion * 64",
		"text": "极为精纯的活泼能量，甚至有起死回生的功用。\n增加相当于256倍蓝血瓶的生命。"
	},
	"I621": {
		"cls": "items",
		"name": "超黄补给品",
		"itemEffect": "core.status.hero.hp += core.values.greenPotion * 128 * core.status.thisMap.ratio",
		"itemEffectTip": "，生命+${core.values.greenPotion * core.status.thisMap.ratio * 128}",
		"useItemEffect": "core.status.hero.hp += core.values.greenPotion * 128",
		"text": "极为精纯的活泼能量，甚至有起死回生的功用。\n增加相当于256倍黄血瓶的生命。"
	},
	"I622": {
		"cls": "items",
		"name": "超绿补给品",
		"itemEffect": "core.status.hero.hp += core.values.greenPotion * 256 * core.status.thisMap.ratio",
		"itemEffectTip": "，生命+${core.values.greenPotion * core.status.thisMap.ratio * 256}",
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
		"name": "新物品",
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
		"name": "残墟剑",
		"canUseItemEffect": "true",
		"itemEffect": "core.status.hero.atk += 35000",
		"itemEffectTip": "，攻击+35000"
	},
	"I630": {
		"cls": "items",
		"name": "新物品",
		"canUseItemEffect": "true"
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
		"itemEffectTip": "，攻击+${core.values.redGem * core.status.thisMap.ratio*10}",
		"text": "普通人一生难得一见的红色晶体，能够使身体如有神助，神力盖世。\n直接增加10倍于普通红宝石的攻击力。"
	},
	"I636": {
		"cls": "items",
		"name": "殿堂蓝宝石",
		"canUseItemEffect": "true",
		"itemEffect": "core.status.hero.def += core.values.blueGem * core.status.thisMap.ratio * 10",
		"itemEffectTip": "，防御+${core.values.blueGem * core.status.thisMap.ratio*10}",
		"text": "普通人一生难得一见的蓝色晶体，能够使人的筋骨产生质的蜕变，脱胎换骨。\n直接增加10倍于普通蓝宝石的防御力。"
	},
	"I637": {
		"cls": "items",
		"name": "殿堂绿宝石",
		"itemEffect": "core.status.hero.mdef += core.values.greenGem * core.status.thisMap.ratio * 10",
		"itemEffectTip": "，护盾+${core.values.greenGem * core.status.thisMap.ratio*10}",
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
		"itemEffectTip": "，攻击+${core.values.redGem * core.status.thisMap.ratio*20}",
		"text": "普通人一生难得一见的红色晶体，能够使身体如有神助，神力盖世。\n直接增加20倍于普通红宝石的攻击力。"
	},
	"I640": {
		"cls": "items",
		"name": "史诗蓝宝石",
		"canUseItemEffect": "true",
		"itemEffect": "core.status.hero.def += core.values.blueGem * core.status.thisMap.ratio * 20",
		"itemEffectTip": "，防御+${core.values.blueGem * core.status.thisMap.ratio*20}"
	},
	"I641": {
		"cls": "items",
		"name": "史诗绿宝石",
		"canUseItemEffect": "true",
		"text": "世间罕有的绿色晶体，其蓬勃的生命力足以滋养一方小世界。\n直接增加20倍于普通绿宝石的护盾。",
		"itemEffect": "core.status.hero.mdef += core.values.greenGem * core.status.thisMap.ratio * 20",
		"itemEffectTip": "，护盾+${core.values.greenGem * core.status.thisMap.ratio*20}"
	},
	"I642": {
		"cls": "items",
		"name": "史诗黄宝石",
		"canUseItemEffect": "true",
		"itemEffect": "core.status.hero.atk += core.values.redGem * core.status.thisMap.ratio * 20;\ncore.status.hero.def += core.values.blueGem * core.status.thisMap.ratio * 20;\ncore.status.hero.mdef += core.values.greenGem * core.status.thisMap.ratio * 20;\ncore.status.hero.hp += core.values.yellowPotion * core.status.thisMap.ratio * 20;",
		"itemEffectTip": "，全属性提升",
		"text": "其出世时，世人为之的震撼足以载入史册的黄色晶体。\n直接增加20倍于普通黄宝石的全属性。"
	},
	"I643": {
		"cls": "items",
		"name": "传说红宝石",
		"canUseItemEffect": "true",
		"itemEffect": "core.status.hero.atk += core.values.redGem * core.status.thisMap.ratio * 50",
		"itemEffectTip": "，攻击+${core.values.redGem * core.status.thisMap.ratio*50}",
		"text": "普通人一生难得一见的红色晶体，能够使身体如有神助，神力盖世。\n直接增加50倍于普通红宝石的攻击力。"
	},
	"I644": {
		"cls": "items",
		"name": "传说蓝宝石",
		"canUseItemEffect": "true",
		"itemEffect": "core.status.hero.def += core.values.blueGem * core.status.thisMap.ratio * 50",
		"itemEffectTip": "，防御+${core.values.blueGem * core.status.thisMap.ratio*50}"
	},
	"I645": {
		"cls": "items",
		"name": "传说绿宝石",
		"canUseItemEffect": "true",
		"text": "世间罕有的绿色晶体，其蓬勃的生命力足以滋养一方小世界。\n直接增加50倍于普通绿宝石的护盾。",
		"itemEffect": "core.status.hero.mdef += core.values.greenGem * core.status.thisMap.ratio * 50",
		"itemEffectTip": "，护盾+${core.values.greenGem * core.status.thisMap.ratio*50}"
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
		"itemEffect": "core.status.hero.mdef += 3000000;\ncore.status.hero.hp += 60000000;",
		"itemEffectTip": "，护盾+300万，生命+6000万"
	},
	"I652": {
		"cls": "items",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I653": {
		"cls": "items",
		"name": "潺水剑",
		"canUseItemEffect": "true",
		"itemEffect": "core.status.hero.atk += 4000",
		"itemEffectTip": "，攻击+4000"
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
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I657": {
		"cls": "items",
		"name": "新物品",
		"canUseItemEffect": "true"
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
		"cls": "items",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I733": {
		"cls": "items",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I734": {
		"cls": "items",
		"name": "初等进化结晶",
		"canUseItemEffect": "true",
		"text": "天地间充沛的能量滋养诞生的晶体，\n接触后能够化作海量的领悟为人所用。\n角色增加100领悟。",
		"itemEffect": "core.status.hero.exp += 2000000",
		"itemEffectTip": "，经验+2000000"
	},
	"I735": {
		"cls": "items",
		"name": "高等领悟结晶",
		"canUseItemEffect": "true",
		"text": "天地间充沛的能量滋养诞生的晶体，\n接触后能够化作海量的领悟为人所用。\n角色增加1000领悟。",
		"itemEffect": "core.status.hero.money += 1000",
		"itemEffectTip": "，领悟+1000"
	},
	"I736": {
		"cls": "items",
		"name": "极品领悟结晶",
		"canUseItemEffect": "true",
		"text": "天地间充沛的能量滋养诞生的晶体，\n接触后能够化作海量的领悟为人所用。\n角色增加10000领悟。",
		"itemEffect": "core.status.hero.money += 10000",
		"itemEffectTip": "，领悟+10000"
	},
	"I737": {
		"cls": "items",
		"name": "史诗的领悟结晶",
		"canUseItemEffect": "true",
		"text": "天地间充沛的能量滋养诞生的晶体，\n接触后能够化作海量的领悟为人所用。\n角色增加100000领悟。",
		"itemEffect": "core.status.hero.money += 100000",
		"itemEffectTip": "，领悟+100000"
	},
	"I738": {
		"cls": "items",
		"name": "传说的领悟结晶Ⅰ",
		"canUseItemEffect": "true",
		"text": "天地间充沛的能量滋养诞生的晶体，\n接触后能够化作海量的领悟为人所用。\n角色增加100万领悟。",
		"itemEffect": "core.status.hero.money += 10000000",
		"itemEffectTip": "，领悟+1000万"
	},
	"I739": {
		"cls": "items",
		"name": "传说的领悟结晶Ⅱ",
		"canUseItemEffect": "true",
		"text": "天地间充沛的能量滋养诞生的晶体，\n接触后能够化作海量的领悟为人所用。\n角色增加1000万领悟。",
		"itemEffect": "core.status.hero.money += 1000000000",
		"itemEffectTip": "，领悟+10亿"
	},
	"I740": {
		"cls": "items",
		"name": "神话的领悟结晶",
		"canUseItemEffect": "true",
		"text": "天地间充沛的能量滋养诞生的晶体，\n接触后能够化作海量的领悟为人所用。\n角色增加1亿领悟。",
		"itemEffect": "core.status.hero.money += 100000000000",
		"itemEffectTip": "，领悟+1000亿"
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
		"name": "轻质战盾（二阶）",
		"canUseItemEffect": "true",
		"itemEffect": "core.status.hero.def += 20",
		"itemEffectTip": "，防御+20"
	},
	"I773": {
		"cls": "items",
		"name": "轻质战盾",
		"canUseItemEffect": "true",
		"text": "晒干的干草编织成的盾牌。\n防御+3000。",
		"equip": {
			"type": "装备",
			"value": {
				"def": 3000
			},
			"percentage": {}
		},
		"itemEffect": "core.status.hero.def += 8",
		"itemEffectTip": "，防御+8"
	},
	"I774": {
		"cls": "items",
		"name": "轻质战盾（三阶）",
		"canUseItemEffect": "true",
		"itemEffect": "core.status.hero.def += 100",
		"itemEffectTip": "，防御+100"
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
		"name": "灵妖盾",
		"canUseItemEffect": "true",
		"itemEffect": "core.status.hero.def += 4000",
		"itemEffectTip": "，防御+4000"
	},
	"I784": {
		"cls": "items",
		"name": "冰寒果实",
		"canUseItemEffect": "true",
		"itemEffect": "core.status.hero.def += 9000",
		"itemEffectTip": "，防御+9000"
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
		"name": "荒兽盾",
		"canUseItemEffect": "true",
		"itemEffect": "core.status.hero.def += 1500",
		"itemEffectTip": "，防御+1500"
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
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I793": {
		"cls": "items",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I794": {
		"cls": "items",
		"name": "新物品",
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
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I798": {
		"cls": "items",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I799": {
		"cls": "items",
		"name": "新物品",
		"canUseItemEffect": "true"
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
		"name": "兽神残卷（基础）",
		"canUseItemEffect": "true",
		"text": "天生兽神留下来的残卷，蕴含着无穷尽的伟力，带领血洛大陆的荒兽族群走向强盛与繁荣。攻击+1，角色全属性+10%，战斗伤害-40%。",
		"equip": {
			"type": 0,
			"value": {
				"atk": 1
			},
			"percentage": {
				"mdef": 10,
				"def": 10,
				"atk": 10
			}
		}
	},
	"I894": {
		"cls": "equips",
		"name": "融血术",
		"canUseItemEffect": "true",
		"text": "最普遍的血洛术式。角色全属性+10%。",
		"equip": {
			"type": 0,
			"value": {},
			"percentage": {
				"mdef": 10,
				"def": 10,
				"atk": 10
			}
		}
	},
	"I895": {
		"cls": "equips",
		"name": "三月断宵",
		"canUseItemEffect": "true",
		"text": "一位云霄级强者观想天地创出的剑法。角色全属性+25%。",
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
	"I896": {
		"cls": "equips",
		"name": "兽神残卷（一阶初成）",
		"canUseItemEffect": "true",
		"text": "天生兽神留下来的残卷，蕴含着无穷尽的伟力，带领血洛大陆的荒兽族群走向强盛与繁荣。角色全属性+25%，战斗伤害-40%。",
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
	"I897": {
		"cls": "equips",
		"name": "兽神残卷（一阶大成）",
		"canUseItemEffect": "true",
		"text": "天生兽神留下来的残卷，蕴含着无穷尽的伟力，带领血洛大陆的荒兽族群走向强盛与繁荣。角色全属性+45%，战斗伤害-40%。",
		"equip": {
			"type": 0,
			"value": {},
			"percentage": {
				"mdef": 45,
				"def": 45,
				"atk": 45
			}
		}
	},
	"I898": {
		"cls": "equips",
		"name": "水无心",
		"canUseItemEffect": "true",
		"equip": {
			"type": 0,
			"value": {},
			"percentage": {
				"mdef": 45,
				"def": 45,
				"atk": 45
			}
		},
		"text": "无心之水，赐予万物以生命，却不求有功，只求无过。角色全属性+45%。"
	},
	"I899": {
		"cls": "equips",
		"name": "兽神残卷（一阶圆满）",
		"canUseItemEffect": "true",
		"text": "天生兽神留下来的残卷，蕴含着无穷尽的伟力，带领血洛大陆的荒兽族群走向强盛与繁荣。角色全属性+64%，战斗伤害-40%。",
		"equip": {
			"type": 0,
			"value": {},
			"percentage": {
				"mdef": 64,
				"def": 64,
				"atk": 64
			}
		}
	},
	"I900": {
		"cls": "equips",
		"name": "星解之术",
		"canUseItemEffect": "true",
		"equip": {
			"type": 0,
			"value": {},
			"percentage": {
				"mdef": 64,
				"def": 64,
				"atk": 64
			}
		},
		"text": "释放身体蕴含的基因原力，融解星宙间那颗颗璀璨的星辰。角色全属性+64%。"
	},
	"I901": {
		"cls": "equips",
		"name": "映星花",
		"canUseItemEffect": "true",
		"equip": {
			"type": 0,
			"value": {},
			"percentage": {
				"mdef": 80,
				"def": 80,
				"atk": 80
			}
		},
		"text": "绚烂得让人目不暇接的招式，奇异的波动流转，映出彗星尾巴般的光晕，似要将整个星河染上瑰丽的色彩。角色全属性+80%。"
	},
	"I902": {
		"cls": "items",
		"name": "绿钥匙串",
		"canUseItemEffect": "true",
		"itemEffect": "core.addItem('greenKey', 4)",
		"itemEffectTip": ",绿钥匙+4"
	},
	"I920": {
		"cls": "equips",
		"name": "兽神残卷（二阶初成）",
		"canUseItemEffect": "true",
		"equip": {
			"type": 0,
			"value": {},
			"percentage": {
				"mdef": 80,
				"def": 80,
				"atk": 80
			}
		},
		"text": "天生兽神留下来的残卷，蕴含着无穷尽的伟力，带领血洛大陆的荒兽族群走向强盛与繁荣。角色全属性+80%，战斗伤害-40%。"
	},
	"I921": {
		"cls": "equips",
		"name": "兽神残卷（二阶大成）",
		"canUseItemEffect": "true",
		"text": "天生兽神留下来的残卷，蕴含着无穷尽的伟力，带领血洛大陆的荒兽族群走向强盛与繁荣。角色全属性+100%，战斗伤害-40%。",
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
	"I922": {
		"cls": "equips",
		"name": "映星紫华",
		"canUseItemEffect": "true",
		"equip": {
			"type": 0,
			"value": {},
			"percentage": {
				"mdef": 100,
				"def": 100,
				"atk": 100
			}
		},
		"text": "神秘令人难以捉摸的进阶术式，于内敛的紫色光华之中，蕴含着令人心惊胆颤的力量。角色全属性+100%。"
	},
	"I923": {
		"cls": "equips",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I924": {
		"cls": "equips",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I925": {
		"cls": "equips",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I926": {
		"cls": "equips",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I927": {
		"cls": "equips",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I928": {
		"cls": "equips",
		"name": "微火",
		"canUseItemEffect": "true",
		"equip": {
			"type": 3,
			"value": {
				"def": 1000,
				"atk": 1000
			},
			"percentage": {
				"mdef": 20
			}
		},
		"text": "利用简单的精神念力点燃火焰的领悟。\n攻击、防御+1000，护盾+20%。"
	},
	"I929": {
		"cls": "equips",
		"name": "燃灼术",
		"canUseItemEffect": "true",
		"text": "念力火焰灼灼燃烧，仿佛要将这片空间点燃。\n攻击、防御+30000，同时+5%，护盾+20%。",
		"equip": {
			"type": 3,
			"value": {
				"def": 30000,
				"atk": 30000
			},
			"percentage": {
				"mdef": 20,
				"atk": 5,
				"def": 5
			}
		}
	},
	"I930": {
		"cls": "equips",
		"name": "焰海霜天【领域二重】",
		"canUseItemEffect": "true",
		"equip": {
			"type": 3,
			"value": {
				"def": 7290000,
				"atk": 7290000
			},
			"percentage": {
				"mdef": 30,
				"def": 12,
				"atk": 12
			}
		},
		"text": "相互冲突的两种元素调和形成的奇异领域。冰火两重天之下，寒冷与炙热施以双重折磨，生灵勿近。\n攻击、防御+729万，同时+12%，护盾+30%。"
	},
	"I931": {
		"cls": "equips",
		"name": "焰海霜天【领域三重】",
		"canUseItemEffect": "true",
		"text": "相互冲突的两种元素调和形成的奇异领域。冰火两重天之下，寒冷与炙热施以双重折磨，生灵勿近。\n攻击、防御+2916万，同时+20%，护盾+35%。",
		"equip": {
			"type": 3,
			"value": {
				"def": 29160000,
				"atk": 29160000
			},
			"percentage": {
				"mdef": 35,
				"def": 20,
				"atk": 20
			}
		}
	},
	"I932": {
		"cls": "equips",
		"name": "火灵幻海【领域一重】",
		"canUseItemEffect": "true",
		"text": "通体红色的火焰小兽在空中游曳，周身散发的火元素波动汇集成海。\n攻击、防御+30万，同时+8%，护盾+30%。",
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
		"name": "出云落月【领域六重】",
		"canUseItemEffect": "true"
	},
	"I935": {
		"cls": "equips",
		"name": "出云落月【领域七重】",
		"canUseItemEffect": "true"
	},
	"I936": {
		"cls": "equips",
		"name": "出云落月【领域九重】",
		"canUseItemEffect": "true"
	},
	"I937": {
		"cls": "equips",
		"name": "天封火牢【初窥法则】",
		"canUseItemEffect": "true"
	},
	"I938": {
		"cls": "equips",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I939": {
		"cls": "equips",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I940": {
		"cls": "equips",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I941": {
		"cls": "equips",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I942": {
		"cls": "equips",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I943": {
		"cls": "equips",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I944": {
		"cls": "equips",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I945": {
		"cls": "equips",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I946": {
		"cls": "equips",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I947": {
		"cls": "equips",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I948": {
		"cls": "equips",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I949": {
		"cls": "equips",
		"name": "新物品",
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
		"canUseItemEffect": "true"
	},
	"I958": {
		"cls": "tools",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I959": {
		"cls": "tools",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I960": {
		"cls": "tools",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I961": {
		"cls": "tools",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I962": {
		"cls": "tools",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I963": {
		"cls": "tools",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I964": {
		"cls": "tools",
		"name": "新物品",
		"canUseItemEffect": "true"
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
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I982": {
		"cls": "equips",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I983": {
		"cls": "equips",
		"name": "新物品",
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
		"itemEffectTip": ",红钥匙+3"
	},
	"I1009": {
		"cls": "items",
		"name": "圣红补给品",
		"itemEffect": "core.status.hero.hp += core.values.greenPotion * 1024 * core.status.thisMap.ratio",
		"itemEffectTip": "，生命+${core.values.greenPotion * core.status.thisMap.ratio * 1024}",
		"useItemEffect": "core.status.hero.hp += core.values.greenPotion * 1024",
		"text": "极为精纯的活泼能量，甚至有起死回生的功用。\n增加相当于8192倍红血瓶的生命。"
	},
	"I1010": {
		"cls": "items",
		"name": "圣蓝补给品",
		"itemEffect": "core.status.hero.hp += core.values.greenPotion * 4096 * core.status.thisMap.ratio",
		"itemEffectTip": "，生命+${core.values.greenPotion * core.status.thisMap.ratio * 4096}",
		"useItemEffect": "core.status.hero.hp += core.values.greenPotion * 4096",
		"text": "极为精纯的活泼能量，甚至有起死回生的功用。\n增加相当于16384倍蓝血瓶的生命。"
	},
	"I1011": {
		"cls": "items",
		"name": "圣黄补给品",
		"itemEffect": "core.status.hero.hp += core.values.greenPotion * 16384 * core.status.thisMap.ratio",
		"itemEffectTip": "，生命+${core.values.greenPotion * core.status.thisMap.ratio * 16384}",
		"useItemEffect": "core.status.hero.hp += core.values.greenPotion * 16384",
		"text": "极为精纯的活泼能量，甚至有起死回生的功用。\n增加相当于32768倍黄血瓶的生命。"
	},
	"I1012": {
		"cls": "items",
		"name": "圣绿补给品",
		"itemEffect": "core.status.hero.hp += core.values.greenPotion * 65536 * core.status.thisMap.ratio",
		"itemEffectTip": "，生命+${core.values.greenPotion * core.status.thisMap.ratio * 65536}",
		"useItemEffect": "core.status.hero.hp += core.values.greenPotion * 65536",
		"text": "极为精纯的活泼能量，甚至有起死回生的功用。\n增加相当于65536倍绿血瓶的生命。"
	},
	"I1013": {
		"cls": "items",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I1014": {
		"cls": "items",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I1015": {
		"cls": "items",
		"name": "神话绿宝石",
		"canUseItemEffect": "true",
		"itemEffect": "core.status.hero.mdef += core.values.greenGem * core.status.thisMap.ratio * 100",
		"itemEffectTip": "，护盾+${core.values.greenGem * core.status.thisMap.ratio*100}"
	},
	"I1016": {
		"cls": "items",
		"name": "神话黄宝石",
		"canUseItemEffect": "true",
		"itemEffect": "core.status.hero.atk += core.values.redGem * core.status.thisMap.ratio * 100;\ncore.status.hero.def += core.values.blueGem * core.status.thisMap.ratio * 100;\ncore.status.hero.mdef += core.values.greenGem * core.status.thisMap.ratio * 100;\ncore.status.hero.hp += core.values.yellowPotion * core.status.thisMap.ratio * 400;"
	},
	"I1017": {
		"cls": "items",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I1018": {
		"cls": "items",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I1019": {
		"cls": "items",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I1020": {
		"cls": "items",
		"name": "不朽黄宝石",
		"canUseItemEffect": "true",
		"itemEffect": "core.status.hero.atk += core.values.redGem * core.status.thisMap.ratio * 200;\ncore.status.hero.def += core.values.blueGem * core.status.thisMap.ratio * 200;\ncore.status.hero.mdef += core.values.greenGem * core.status.thisMap.ratio * 200;\ncore.status.hero.hp += core.values.yellowPotion * core.status.thisMap.ratio * 1600;"
	},
	"I1021": {
		"cls": "items",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I1022": {
		"cls": "items",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I1023": {
		"cls": "items",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I1024": {
		"cls": "items",
		"name": "混沌黄宝石",
		"canUseItemEffect": "true",
		"itemEffect": "core.status.hero.atk += core.values.redGem * core.status.thisMap.ratio * 500;\ncore.status.hero.def += core.values.blueGem * core.status.thisMap.ratio * 500;\ncore.status.hero.mdef += core.values.greenGem * core.status.thisMap.ratio * 500;\ncore.status.hero.hp += core.values.yellowPotion * core.status.thisMap.ratio * 6400;"
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
		"cls": "items",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I1030": {
		"cls": "items",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I1031": {
		"cls": "constants",
		"name": "幸运数字 - 6",
		"canUseItemEffect": "false",
		"text": "幸运数字 - 6"
	},
	"I1032": {
		"cls": "items",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I1033": {
		"cls": "items",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I1034": {
		"cls": "items",
		"name": "新物品",
		"canUseItemEffect": "true"
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
		"cls": "equips",
		"name": "御幻珠",
		"canUseItemEffect": "true",
		"text": ""
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
		"canUseItemEffect": "true"
	},
	"I1127": {
		"cls": "equips",
		"name": "银霜月轮（四重）",
		"canUseItemEffect": "true"
	},
	"I1128": {
		"cls": "items",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I1129": {
		"cls": "items",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I1130": {
		"cls": "constants",
		"name": "幸运数字 - C",
		"canUseItemEffect": "true",
		"text": "幸运数字 - C"
	},
	"I1131": {
		"cls": "items",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I1132": {
		"cls": "items",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I1133": {
		"cls": "items",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I1134": {
		"cls": "items",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I1135": {
		"cls": "items",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I1136": {
		"cls": "items",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I1137": {
		"cls": "items",
		"name": "新物品",
		"canUseItemEffect": "true"
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
		"cls": "items",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I1144": {
		"cls": "items",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I1145": {
		"cls": "items",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I1146": {
		"cls": "items",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I1147": {
		"cls": "items",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I1148": {
		"cls": "items",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I1149": {
		"cls": "items",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I1150": {
		"cls": "items",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I1151": {
		"cls": "items",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I1152": {
		"cls": "items",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I1153": {
		"cls": "items",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I1154": {
		"cls": "items",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I1155": {
		"cls": "items",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I1156": {
		"cls": "items",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I1157": {
		"cls": "items",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I1158": {
		"cls": "items",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I1159": {
		"cls": "items",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I1160": {
		"cls": "items",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I1161": {
		"cls": "items",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I1162": {
		"cls": "items",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I1163": {
		"cls": "items",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I1164": {
		"cls": "items",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I1165": {
		"cls": "items",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I1166": {
		"cls": "items",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I1167": {
		"cls": "items",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I1168": {
		"cls": "items",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I1169": {
		"cls": "items",
		"name": "新物品",
		"canUseItemEffect": "true"
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
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I1174": {
		"cls": "items",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I1175": {
		"cls": "items",
		"name": "新物品",
		"canUseItemEffect": "true"
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
		"cls": "items",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I1179": {
		"cls": "items",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I1180": {
		"cls": "items",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I1181": {
		"cls": "items",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I1182": {
		"cls": "items",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I1183": {
		"cls": "items",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I1184": {
		"cls": "items",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I1185": {
		"cls": "items",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I1186": {
		"cls": "items",
		"name": "新物品",
		"canUseItemEffect": "true"
	},
	"I1187": {
		"cls": "items",
		"name": "新物品",
		"canUseItemEffect": "true"
	}
}
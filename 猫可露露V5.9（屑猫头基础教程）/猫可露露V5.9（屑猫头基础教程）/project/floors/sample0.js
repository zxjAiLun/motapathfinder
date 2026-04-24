main.floors.sample0=
{
    "floorId": "sample0",
    "title": "样板 0 层",
    "name": "0",
    "canFlyTo": true,
    "canFlyFrom": true,
    "canUseQuickShop": true,
    "defaultGround": "ground",
    "images": [],
    "bgm": "bgm.mp3",
    "ratio": 1,
    "map": [
    [  0,  0,220,  0,  0, 20, 87,  3, 58, 59, 60, 61, 64],
    [  0,246,  0,246,  0, 20,  0,  3, 57, 72, 63, 43, 44],
    [219,  0,  0,  0,219, 20,  0,  3, 53, 54, 55, 56, 69],
    [ 20, 20,125, 20, 20, 20,716,  3, 49, 50, 51, 52, 68],
    [251,247,256,234,248,  6,10287,  3,  0, 36, 46, 47, 48],
    [  6,  6,125,  6,  6,  6,10186,  3,  0,  0,  0,  0,  0],
    [208,227,212,216,278,  5,10187,  1,  1,  1,319,  1,  1],
    [201,205,217,215,224,  5,10188,  1, 27, 28, 29, 30, 31],
    [  5,  5,125,  5,  5,  5,10189,  1, 21, 22, 23, 24, 26],
    [  0,  0,263,  0,  0,  0,10193,  1,  1,  1,121,  1,  1],
    [  4,  4,133,  4,  4,  4,  0,10287,  0,  0,  0, 85,124],
    [ 87, 11, 12, 13, 14,  4,  4,  2,  2,122,  2,  2,  2],
    [ 88, 89, 90, 91, 92, 93, 94,  2, 81, 82, 83, 84, 86]
],
    "firstArrive": [
        {
            "type": "showStatusBar"
        },
        {
            "type": "setText",
            "background": "winskin.png",
            "time": 0
        },
        "\t[样板提示]首次到达某层可以触发 firstArrive 事件，该事件可类似于RMXP中的“自动执行脚本”。\n\n本事件支持一切的事件类型，常常用来触发对话，例如：",
        "\t[hero]\b[up,hero]我是谁？我从哪来？我又要到哪去？",
        "\t[仙子,fairy]你问我...？我也不知道啊...",
        "本层主要对道具、门、怪物等进行介绍，有关事件的各种信息在下一层会有更为详细的说明。"
    ],
    "events": {
        "2,10": [
            "\t[少女,npc0]\b[this]这些是路障、楼梯、传送门。",
            "\t[少女,npc1]\b[this]血网的伤害数值、中毒后每步伤害数值、衰弱时攻防下降的数值，都在全塔属性（快捷键B）的全局数值（values）内定义。\n\n路障同样会尽量被自动寻路绕过。",
            "\t[少女,npc2]\b[this]楼梯和传送门需要在地图选点（快捷键X）的“楼层转换”中定义目标楼层和位置，可参见样板里已有的的写法。",
            {
                "type": "hide",
                "time": 500
            }
        ],
        "2,5": [
            "\t[老人,wizard]\b[this]模仿、吸血、中毒、衰弱、诅咒。\n\n请注意吸血怪需要设置value为吸血数值，可参见样板中黑暗大法师的写法。",
            {
                "type": "hide",
                "time": 500
            }
        ],
        "2,3": [
            "\t[老人,wizard]\b[this]领域、夹击。\n请注意领域怪需要设置value为伤害数值，可参见样板中初级巫师的写法。",
            "\t[老人,wizard]\b[this]当领域、阻击、激光和夹击同时发生时，先计算领域、阻击、激光（同时计算），再计算夹击。\n自动寻路同样会尽量绕过这些区域。",
            {
                "type": "hide",
                "time": 500
            }
        ],
        "12,10": {
            "trigger": null,
            "enable": false,
            "noPass": null,
            "displayDamage": true,
            "data": [
                "\t[仙子,fairy]\b[this]只有楼上启用事件后，才能看到我并可以和我对话来触发事件。",
                {
                    "type": "hide",
                    "time": 500
                }
            ]
        },
        "2,8": [
            "\t[老人,wizard]\b[this]这些都是各种各样的怪物，所有怪物的数据都在 project 文件夹的 enemys.js 中设置。\n（注意是 enemys，而非 enemies）",
            "\t[老人,wizard]\b[this]这批怪物分别为：\n\\i[greenSlime]普通、\\i[bat]先攻、\\i[bluePriest]魔攻、\\i[rock]坚固、\\i[swordsman]2连击、\\i[vampire]多连击、\\i[redKnight]破甲、\\i[ghostSoldier]反击、\\i[slimeman]净化。",
            "\t[老人,wizard]\b[this]打败怪物后可触发 afterBattle 事件。\n\n有关事件的各种信息在下一层会有更为详细的说明。",
            {
                "type": "hide",
                "time": 500
            }
        ],
        "9,11": [
            "\t[老人,trader]\b[this]这些是门，需要对应的钥匙打开。\n机关门必须使用特殊的开法。",
            "\t[老人,trader]\b[this]开门后可触发 afterOpenDoor 事件。\n\n有关事件的各种信息在下一层会有更为详细的说明。",
            {
                "type": "hide",
                "time": 500
            }
        ],
        "10,9": [
            "\t[老人,man]\b[down,null]这些是部分本样板支持的道具。\n\n道具分为 items、constants、tools、equips 四类。\nitems 为即捡即用类道具，例如宝石、血瓶等。\nconstants 为永久道具，例如怪物手册、楼层传送器、幸运金币等。\ntools 为消耗类道具，例如破墙镐、炸弹、中心对称飞行器等。\nequips 为装备，例如剑盾等。",
            "\t[老人,man]\b[up]有关道具效果，定义在project文件夹的items.js中。\n目前大多数道具已有默认行为，如有自定义的需求请修改道具的图块属性。",
            "\t[老人,man]\b[up]拾取道具结束后可触发 afterGetItem 事件。\n\n有关事件的各种信息在下一层会有更为详细的说明。",
            {
                "type": "hide",
                "time": 500
            }
        ],
        "6,3": [
            {
                "type": "choices",
                "text": "\t[千夜,E716]如果你喜欢本作，\n可以关注我的B站账号：幼年猫妖，以第一时间获取更新信息。\n也可以加入讨论群947190984，与作者和其他玩家交流讨论。\n每一份这样的支持都可以为作者提供更多的精神动力。",
                "choices": [
                    {
                        "text": "作者的个人主页",
                        "action": [
                            {
                                "type": "function",
                                "function": "function(){\nwindow.open(\"https://space.bilibili.com/13853635?spm_id_from=333.1007.0.0\")\n}"
                            }
                        ]
                    },
                    {
                        "text": "作者的更多作品",
                        "action": [
                            {
                                "type": "choices",
                                "text": "\t[E716]B站账号：\r[yellow]幼年猫妖\r\n讨论群：\r[yellow]947190984\r",
                                "choices": [
                                    {
                                        "text": "反物质分裂症",
                                        "action": [
                                            {
                                                "type": "function",
                                                "function": "function(){\nwindow.open(\"https://h5mota.com/games/Antimatter/\")\n}"
                                            }
                                        ]
                                    },
                                    {
                                        "text": "星之葬",
                                        "action": [
                                            {
                                                "type": "function",
                                                "function": "function(){\nwindow.open(\"https://h5mota.com/games/Star/\")\n}"
                                            }
                                        ]
                                    },
                                    {
                                        "text": "花之伤",
                                        "action": [
                                            {
                                                "type": "function",
                                                "function": "function(){\nwindow.open(\"https://h5mota.com/games/Flower/\")\n}"
                                            }
                                        ]
                                    },
                                    {
                                        "text": "时盘乐园",
                                        "action": [
                                            {
                                                "type": "function",
                                                "function": "function(){\nwindow.open(\"https://h5mota.com/games/Time/\")\n}"
                                            }
                                        ]
                                    },
                                    {
                                        "text": "完美生命",
                                        "action": [
                                            {
                                                "type": "function",
                                                "function": "function(){\nwindow.open(\"https://h5mota.com/games/Perfect/\")\n}"
                                            }
                                        ]
                                    },
                                    {
                                        "text": "殉道者",
                                        "action": [
                                            {
                                                "type": "function",
                                                "function": "function(){\nwindow.open(\"https://h5mota.com/games/Martyr/\")\n}"
                                            }
                                        ]
                                    },
                                    {
                                        "text": "空白",
                                        "action": [
                                            {
                                                "type": "function",
                                                "function": "function(){\nwindow.open(\"https://h5mota.com/games/Blank/\")\n}"
                                            }
                                        ]
                                    },
                                    {
                                        "text": "纯黑",
                                        "action": [
                                            {
                                                "type": "function",
                                                "function": "function(){\nwindow.open(\"https://h5mota.com/games/Black/\")\n}"
                                            }
                                        ]
                                    },
                                    {
                                        "text": "下一页",
                                        "action": [
                                            {
                                                "type": "choices",
                                                "text": "\t[E716]B站账号：\r[yellow]幼年猫妖\r\n讨论群：\r[yellow]947190984\r",
                                                "choices": [
                                                    {
                                                        "text": "夜花吟",
                                                        "action": [
                                                            {
                                                                "type": "function",
                                                                "function": "function(){\nwindow.open(\"https://h5mota.com/games/Night/\")\n}"
                                                            }
                                                        ]
                                                    },
                                                    {
                                                        "text": "纸船效应",
                                                        "action": [
                                                            {
                                                                "type": "function",
                                                                "function": "function(){\nwindow.open(\"https://h5mota.com/games/Boat/\")\n}"
                                                            }
                                                        ]
                                                    },
                                                    {
                                                        "text": "不死少女",
                                                        "action": [
                                                            {
                                                                "type": "function",
                                                                "function": "function(){\nwindow.open(\"https://h5mota.com/games/Alive/\")\n}"
                                                            }
                                                        ]
                                                    },
                                                    {
                                                        "text": "潮汐之囚",
                                                        "action": [
                                                            {
                                                                "type": "function",
                                                                "function": "function(){\nwindow.open(\"https://h5mota.com/games/Sea/\")\n}"
                                                            }
                                                        ]
                                                    },
                                                    {
                                                        "text": "光风霁月 ~ 晴之章",
                                                        "action": [
                                                            {
                                                                "type": "function",
                                                                "function": "function(){\nwindow.open(\"https://h5mota.com/games/ToWish/\")\n}"
                                                            }
                                                        ]
                                                    },
                                                    {
                                                        "text": "花与泪的瞬间",
                                                        "action": [
                                                            {
                                                                "type": "function",
                                                                "function": "function(){\nwindow.open(\"https://h5mota.com/games/Forever/\")\n}"
                                                            }
                                                        ]
                                                    },
                                                    {
                                                        "text": "萤之盲",
                                                        "action": [
                                                            {
                                                                "type": "function",
                                                                "function": "function(){\nwindow.open(\"https://h5mota.com/games/Blind/\")\n}"
                                                            }
                                                        ]
                                                    },
                                                    {
                                                        "text": "夕之降",
                                                        "action": [
                                                            {
                                                                "type": "function",
                                                                "function": "function(){\nwindow.open(\"https://h5mota.com/games/Decline/\")\n}"
                                                            }
                                                        ]
                                                    },
                                                    {
                                                        "text": "吃小雨",
                                                        "action": [
                                                            {
                                                                "type": "function",
                                                                "function": "function(){\nwindow.open(\"https://h5mota.com/games/xiaoyu/\")\n}"
                                                            }
                                                        ]
                                                    },
                                                    {
                                                        "text": "返回标题",
                                                        "action": [
                                                            {
                                                                "type": "restart"
                                                            }
                                                        ]
                                                    }
                                                ]
                                            }
                                        ]
                                    },
                                    {
                                        "text": "返回标题",
                                        "action": [
                                            {
                                                "type": "restart"
                                            }
                                        ]
                                    }
                                ]
                            }
                        ]
                    }
                ]
            },
            {
                "type": "insert",
                "loc": [
                    6,
                    3
                ],
                "floorId": "sample0"
            }
        ],
        "6,4": [
            {
                "type": "choices",
                "text": "可以在这里进行跳关。\n初次游玩的玩家建议从头开始游戏，\n以完整了解故事和积累下更多资源。\n不能跳关到已经通过的节点。",
                "choices": [
                    {
                        "text": "离去…",
                        "action": []
                    },
                    {
                        "text": "第二幕",
                        "color": [
                            86,
                            241,
                            144,
                            1
                        ],
                        "condition": "item:I952==0",
                        "_collapsed": true,
                        "action": [
                            {
                                "type": "insert",
                                "name": "清空状态"
                            },
                            {
                                "type": "changeFloor",
                                "floorId": "MT71",
                                "loc": [
                                    6,
                                    12
                                ],
                                "direction": "up"
                            },
                            {
                                "type": "setValue",
                                "name": "status:hp",
                                "value": "3000000"
                            },
                            {
                                "type": "setValue",
                                "name": "status:atk",
                                "value": "7500"
                            },
                            {
                                "type": "setValue",
                                "name": "status:def",
                                "value": "7500"
                            },
                            {
                                "type": "setValue",
                                "name": "status:mdef",
                                "value": "55000"
                            },
                            {
                                "type": "setValue",
                                "name": "item:I600",
                                "value": "1"
                            },
                            {
                                "type": "setValue",
                                "name": "item:yellowKey",
                                "value": "18"
                            },
                            {
                                "type": "setValue",
                                "name": "item:blueKey",
                                "value": "8"
                            },
                            {
                                "type": "setValue",
                                "name": "item:redKey",
                                "value": "2"
                            },
                            {
                                "type": "setValue",
                                "name": "item:pickaxe",
                                "value": "2"
                            },
                            {
                                "type": "setValue",
                                "name": "item:centerFly",
                                "value": "2"
                            },
                            {
                                "type": "setValue",
                                "name": "status:lv",
                                "value": "9"
                            },
                            {
                                "type": "setValue",
                                "name": "status:exp",
                                "value": "82000"
                            },
                            {
                                "type": "setValue",
                                "name": "item:greenKey",
                                "value": "0"
                            },
                            {
                                "type": "setValue",
                                "name": "item:I896",
                                "value": "1"
                            },
                            {
                                "type": "setValue",
                                "name": "item:I952",
                                "value": "1"
                            },
                            {
                                "type": "setValue",
                                "name": "flag:saltygreen",
                                "operator": "+=",
                                "value": "24"
                            },
                            {
                                "type": "loadEquip",
                                "id": "I896"
                            }
                        ]
                    },
                    {
                        "text": "第三幕",
                        "color": [
                            114,
                            182,
                            229,
                            1
                        ],
                        "condition": "item:I953==0",
                        "_collapsed": true,
                        "action": [
                            {
                                "type": "insert",
                                "name": "清空状态"
                            },
                            {
                                "type": "changeFloor",
                                "floorId": "MT201",
                                "loc": [
                                    6,
                                    7
                                ],
                                "direction": "up"
                            },
                            {
                                "type": "setValue",
                                "name": "status:hp",
                                "value": "4000000000"
                            },
                            {
                                "type": "setValue",
                                "name": "status:atk",
                                "value": "6000000"
                            },
                            {
                                "type": "setValue",
                                "name": "status:def",
                                "value": "6000000"
                            },
                            {
                                "type": "setValue",
                                "name": "status:mdef",
                                "value": "55000000"
                            },
                            {
                                "type": "setValue",
                                "name": "item:I600",
                                "value": "1"
                            },
                            {
                                "type": "setValue",
                                "name": "item:yellowKey",
                                "value": "45"
                            },
                            {
                                "type": "setValue",
                                "name": "item:blueKey",
                                "value": "25"
                            },
                            {
                                "type": "setValue",
                                "name": "item:redKey",
                                "value": "4"
                            },
                            {
                                "type": "setValue",
                                "name": "item:pickaxe",
                                "value": "4"
                            },
                            {
                                "type": "setValue",
                                "name": "item:centerFly",
                                "value": "4"
                            },
                            {
                                "type": "setValue",
                                "name": "status:lv",
                                "value": "19"
                            },
                            {
                                "type": "setValue",
                                "name": "status:exp",
                                "value": "750000"
                            },
                            {
                                "type": "setValue",
                                "name": "item:greenKey",
                                "value": "0"
                            },
                            {
                                "type": "setValue",
                                "name": "item:I899",
                                "value": "1"
                            },
                            {
                                "type": "setValue",
                                "name": "item:I932",
                                "value": "1"
                            },
                            {
                                "type": "setValue",
                                "name": "item:I977",
                                "value": "1"
                            },
                            {
                                "type": "setValue",
                                "name": "item:I952",
                                "value": "1"
                            },
                            {
                                "type": "setValue",
                                "name": "item:I953",
                                "value": "1"
                            },
                            {
                                "type": "setValue",
                                "name": "flag:saltygreen",
                                "operator": "+=",
                                "value": "60"
                            },
                            {
                                "type": "loadEquip",
                                "id": "I899"
                            },
                            {
                                "type": "loadEquip",
                                "id": "I932"
                            },
                            {
                                "type": "loadEquip",
                                "id": "I977"
                            }
                        ]
                    },
                    {
                        "text": "第四幕",
                        "color": [
                            220,
                            139,
                            224,
                            1
                        ],
                        "condition": "item:I954==0",
                        "_collapsed": true,
                        "action": [
                            {
                                "type": "insert",
                                "name": "清空状态"
                            },
                            {
                                "type": "changeFloor",
                                "floorId": "MT351",
                                "loc": [
                                    7,
                                    8
                                ],
                                "direction": "up"
                            },
                            {
                                "type": "setValue",
                                "name": "status:hp",
                                "value": "15e12"
                            },
                            {
                                "type": "setValue",
                                "name": "status:atk",
                                "value": "60e8"
                            },
                            {
                                "type": "setValue",
                                "name": "status:def",
                                "value": "61e8"
                            },
                            {
                                "type": "setValue",
                                "name": "status:mdef",
                                "value": "380e8"
                            },
                            {
                                "type": "setValue",
                                "name": "item:I600",
                                "value": "1"
                            },
                            {
                                "type": "setValue",
                                "name": "item:yellowKey",
                                "value": "90"
                            },
                            {
                                "type": "setValue",
                                "name": "item:blueKey",
                                "value": "50"
                            },
                            {
                                "type": "setValue",
                                "name": "item:redKey",
                                "value": "12"
                            },
                            {
                                "type": "setValue",
                                "name": "item:pickaxe",
                                "value": "12"
                            },
                            {
                                "type": "setValue",
                                "name": "item:centerFly",
                                "value": "12"
                            },
                            {
                                "type": "setValue",
                                "name": "status:lv",
                                "value": "26"
                            },
                            {
                                "type": "setValue",
                                "name": "status:exp",
                                "value": "175e6"
                            },
                            {
                                "type": "setValue",
                                "name": "item:greenKey",
                                "value": "0"
                            },
                            {
                                "type": "setValue",
                                "name": "item:I921",
                                "value": "1"
                            },
                            {
                                "type": "setValue",
                                "name": "item:I933",
                                "value": "1"
                            },
                            {
                                "type": "setValue",
                                "name": "item:I1125",
                                "value": "1"
                            },
                            {
                                "type": "setValue",
                                "name": "item:I978",
                                "value": "1"
                            },
                            {
                                "type": "setValue",
                                "name": "item:I952",
                                "value": "1"
                            },
                            {
                                "type": "setValue",
                                "name": "item:I953",
                                "value": "1"
                            },
                            {
                                "type": "setValue",
                                "name": "item:I954",
                                "value": "1"
                            },
                            {
                                "type": "setValue",
                                "name": "flag:saltygreen",
                                "operator": "+=",
                                "value": "128"
                            },
                            {
                                "type": "loadEquip",
                                "id": "I921"
                            },
                            {
                                "type": "loadEquip",
                                "id": "I933"
                            },
                            {
                                "type": "loadEquip",
                                "id": "I1125"
                            },
                            {
                                "type": "loadEquip",
                                "id": "I978"
                            }
                        ]
                    },
                    {
                        "text": "第五幕",
                        "color": [
                            229,
                            95,
                            146,
                            1
                        ],
                        "condition": "item:I954==0",
                        "_collapsed": true,
                        "action": [
                            {
                                "type": "insert",
                                "name": "清空状态"
                            },
                            {
                                "type": "changeFloor",
                                "floorId": "MT501",
                                "loc": [
                                    10,
                                    4
                                ],
                                "direction": "down"
                            },
                            {
                                "type": "setValue",
                                "name": "status:hp",
                                "value": "12e16"
                            },
                            {
                                "type": "setValue",
                                "name": "status:atk",
                                "value": "730e10"
                            },
                            {
                                "type": "setValue",
                                "name": "status:def",
                                "value": "740e10"
                            },
                            {
                                "type": "setValue",
                                "name": "status:mdef",
                                "value": "100e12"
                            },
                            {
                                "type": "setValue",
                                "name": "item:I600",
                                "value": "1"
                            },
                            {
                                "type": "setValue",
                                "name": "item:yellowKey",
                                "value": "128"
                            },
                            {
                                "type": "setValue",
                                "name": "item:blueKey",
                                "value": "72"
                            },
                            {
                                "type": "setValue",
                                "name": "item:redKey",
                                "value": "18"
                            },
                            {
                                "type": "setValue",
                                "name": "item:pickaxe",
                                "value": "18"
                            },
                            {
                                "type": "setValue",
                                "name": "item:centerFly",
                                "value": "18"
                            },
                            {
                                "type": "setValue",
                                "name": "item:I732",
                                "value": "6"
                            },
                            {
                                "type": "setValue",
                                "name": "item:I733",
                                "value": "6"
                            },
                            {
                                "type": "setValue",
                                "name": "status:lv",
                                "value": "31"
                            },
                            {
                                "type": "setValue",
                                "name": "status:exp",
                                "value": "80e8"
                            },
                            {
                                "type": "setValue",
                                "name": "item:greenKey",
                                "value": "0"
                            },
                            {
                                "type": "setValue",
                                "name": "item:I924",
                                "value": "1"
                            },
                            {
                                "type": "setValue",
                                "name": "item:I939",
                                "value": "1"
                            },
                            {
                                "type": "setValue",
                                "name": "item:I1125",
                                "value": "1"
                            },
                            {
                                "type": "setValue",
                                "name": "item:I978",
                                "value": "1"
                            },
                            {
                                "type": "setValue",
                                "name": "item:I952",
                                "value": "1"
                            },
                            {
                                "type": "setValue",
                                "name": "item:I953",
                                "value": "1"
                            },
                            {
                                "type": "setValue",
                                "name": "item:I954",
                                "value": "1"
                            },
                            {
                                "type": "setValue",
                                "name": "item:I955",
                                "value": "1"
                            },
                            {
                                "type": "setValue",
                                "name": "flag:saltygreen",
                                "operator": "+=",
                                "value": "225"
                            },
                            {
                                "type": "setGlobalFlag",
                                "name": "s:enableMoney",
                                "value": true
                            },
                            {
                                "type": "loadEquip",
                                "id": "I924"
                            },
                            {
                                "type": "loadEquip",
                                "id": "I939"
                            },
                            {
                                "type": "loadEquip",
                                "id": "I1125"
                            },
                            {
                                "type": "loadEquip",
                                "id": "I978"
                            }
                        ]
                    },
                    {
                        "text": "第六幕",
                        "color": [
                            221,
                            220,
                            133,
                            1
                        ],
                        "condition": "item:I954==0",
                        "_collapsed": true,
                        "action": [
                            {
                                "type": "insert",
                                "name": "清空状态"
                            },
                            {
                                "type": "changeFloor",
                                "floorId": "MT651",
                                "loc": [
                                    6,
                                    11
                                ],
                                "direction": "up"
                            },
                            {
                                "type": "setValue",
                                "name": "status:hp",
                                "value": "6400e16"
                            },
                            {
                                "type": "setValue",
                                "name": "status:atk",
                                "value": "1360e12"
                            },
                            {
                                "type": "setValue",
                                "name": "status:def",
                                "value": "1360e12"
                            },
                            {
                                "type": "setValue",
                                "name": "status:mdef",
                                "value": "18e15"
                            },
                            {
                                "type": "setValue",
                                "name": "item:I600",
                                "value": "1"
                            },
                            {
                                "type": "setValue",
                                "name": "item:yellowKey",
                                "value": "160"
                            },
                            {
                                "type": "setValue",
                                "name": "item:blueKey",
                                "value": "96"
                            },
                            {
                                "type": "setValue",
                                "name": "item:redKey",
                                "value": "25"
                            },
                            {
                                "type": "setValue",
                                "name": "item:pickaxe",
                                "value": "25"
                            },
                            {
                                "type": "setValue",
                                "name": "item:centerFly",
                                "value": "25"
                            },
                            {
                                "type": "setValue",
                                "name": "item:I732",
                                "value": "12"
                            },
                            {
                                "type": "setValue",
                                "name": "item:I733",
                                "value": "12"
                            },
                            {
                                "type": "setValue",
                                "name": "status:lv",
                                "value": "36"
                            },
                            {
                                "type": "setValue",
                                "name": "status:exp",
                                "value": "0"
                            },
                            {
                                "type": "setValue",
                                "name": "status:money",
                                "value": "20000"
                            },
                            {
                                "type": "setValue",
                                "name": "item:greenKey",
                                "value": "0"
                            },
                            {
                                "type": "setValue",
                                "name": "item:I952",
                                "value": "1"
                            },
                            {
                                "type": "setValue",
                                "name": "item:I953",
                                "value": "1"
                            },
                            {
                                "type": "setValue",
                                "name": "item:I954",
                                "value": "1"
                            },
                            {
                                "type": "setValue",
                                "name": "item:I955",
                                "value": "1"
                            },
                            {
                                "type": "setValue",
                                "name": "item:I956",
                                "value": "1"
                            },
                            {
                                "type": "setValue",
                                "name": "item:I1740",
                                "value": "1"
                            },
                            {
                                "type": "setValue",
                                "name": "item:I945",
                                "value": "1"
                            },
                            {
                                "type": "setValue",
                                "name": "flag:saltygreen",
                                "operator": "+=",
                                "value": "384"
                            },
                            {
                                "type": "setGlobalFlag",
                                "name": "s:enableMoney",
                                "value": true
                            },
                            {
                                "type": "loadEquip",
                                "id": "I1740"
                            },
                            {
                                "type": "openShop",
                                "id": "Q2"
                            },
                            {
                                "type": "openShop",
                                "id": "L2"
                            },
                            {
                                "type": "openShop",
                                "id": "X1"
                            },
                            {
                                "type": "openShop",
                                "id": "world"
                            },
                            "在领悟商店内可自选装备。\n电脑端按V键，\n手机端按下边栏第五个键打开领悟商店。",
                            {
                                "type": "setValue",
                                "name": "item:greenKey",
                                "operator": "+=",
                                "value": "20"
                            },
                            "得到了用于晋升秘法的20把绿钥匙。"
                        ]
                    }
                ]
            }
        ],
        "6,5": [
            {
                "type": "choices",
                "text": "『纳可的心境』——独立于游戏外的挑战副本。\n它服务于不满足原作难度，希望挑战自我的玩家。\n请注意，背包里的心境之石可以降低难度。\n当主塔更新后，新的心境将会同步开启。",
                "choices": [
                    {
                        "text": "第一心境",
                        "color": [
                            221,
                            222,
                            228,
                            1
                        ],
                        "_collapsed": true,
                        "action": [
                            {
                                "type": "insert",
                                "name": "清空状态"
                            },
                            {
                                "type": "setValue",
                                "name": "status:exp",
                                "value": "0"
                            },
                            {
                                "type": "setValue",
                                "name": "status:lv",
                                "value": "1"
                            },
                            {
                                "type": "setValue",
                                "name": "status:hp",
                                "value": "100"
                            },
                            {
                                "type": "setValue",
                                "name": "status:atk",
                                "value": "1"
                            },
                            {
                                "type": "setValue",
                                "name": "status:def",
                                "value": "0"
                            },
                            {
                                "type": "setValue",
                                "name": "status:mdef",
                                "value": "0"
                            },
                            {
                                "type": "setValue",
                                "name": "item:yellowKey",
                                "value": "0"
                            },
                            {
                                "type": "setValue",
                                "name": "item:blueKey",
                                "value": "0"
                            },
                            {
                                "type": "setValue",
                                "name": "item:redKey",
                                "value": "0"
                            },
                            {
                                "type": "setValue",
                                "name": "item:pickaxe",
                                "value": "0"
                            },
                            {
                                "type": "setValue",
                                "name": "item:centerFly",
                                "value": "0"
                            },
                            {
                                "type": "setValue",
                                "name": "item:bomb",
                                "value": "0"
                            },
                            {
                                "type": "setValue",
                                "name": "item:I1182",
                                "value": "1"
                            },
                            {
                                "type": "changeFloor",
                                "floorId": "A1",
                                "loc": [
                                    6,
                                    11
                                ],
                                "direction": "up"
                            }
                        ]
                    },
                    {
                        "text": "第二心境",
                        "color": [
                            230,
                            243,
                            176,
                            1
                        ],
                        "_collapsed": true,
                        "action": [
                            {
                                "type": "insert",
                                "name": "清空状态"
                            },
                            {
                                "type": "insert",
                                "name": "进入心之境界"
                            },
                            {
                                "type": "setValue",
                                "name": "status:exp",
                                "value": "0"
                            },
                            {
                                "type": "setValue",
                                "name": "status:lv",
                                "value": "12"
                            },
                            {
                                "type": "setValue",
                                "name": "status:hp",
                                "value": "6000000"
                            },
                            {
                                "type": "setValue",
                                "name": "status:atk",
                                "value": "48000"
                            },
                            {
                                "type": "setValue",
                                "name": "status:def",
                                "value": "48000"
                            },
                            {
                                "type": "setValue",
                                "name": "status:mdef",
                                "value": "330000"
                            },
                            {
                                "type": "setValue",
                                "name": "item:yellowKey",
                                "value": "6"
                            },
                            {
                                "type": "setValue",
                                "name": "item:blueKey",
                                "value": "3"
                            },
                            {
                                "type": "setValue",
                                "name": "item:redKey",
                                "value": "1"
                            },
                            {
                                "type": "setValue",
                                "name": "item:pickaxe",
                                "value": "1"
                            },
                            {
                                "type": "setValue",
                                "name": "item:centerFly",
                                "value": "1"
                            },
                            {
                                "type": "setValue",
                                "name": "item:bomb",
                                "value": "0"
                            },
                            {
                                "type": "changeFloor",
                                "floorId": "B1",
                                "loc": [
                                    6,
                                    6
                                ],
                                "direction": "down"
                            },
                            {
                                "type": "setValue",
                                "name": "item:I898",
                                "value": "1"
                            },
                            {
                                "type": "setValue",
                                "name": "item:I928",
                                "value": "1"
                            },
                            {
                                "type": "loadEquip",
                                "id": "I898"
                            },
                            {
                                "type": "loadEquip",
                                "id": "I928"
                            }
                        ]
                    },
                    {
                        "text": "第三心境",
                        "color": [
                            140,
                            117,
                            242,
                            1
                        ],
                        "_collapsed": true,
                        "action": [
                            {
                                "type": "insert",
                                "name": "清空状态"
                            },
                            {
                                "type": "insert",
                                "name": "进入心之境界"
                            },
                            {
                                "type": "setValue",
                                "name": "status:exp",
                                "value": "0"
                            },
                            {
                                "type": "setValue",
                                "name": "status:lv",
                                "value": "18"
                            },
                            {
                                "type": "setValue",
                                "name": "status:hp",
                                "value": "255e6"
                            },
                            {
                                "type": "setValue",
                                "name": "status:atk",
                                "value": "2550000"
                            },
                            {
                                "type": "setValue",
                                "name": "status:def",
                                "value": "2550000"
                            },
                            {
                                "type": "setValue",
                                "name": "status:mdef",
                                "value": "20000000"
                            },
                            {
                                "type": "setValue",
                                "name": "item:yellowKey",
                                "value": "7"
                            },
                            {
                                "type": "setValue",
                                "name": "item:blueKey",
                                "value": "4"
                            },
                            {
                                "type": "setValue",
                                "name": "item:redKey",
                                "value": "1"
                            },
                            {
                                "type": "setValue",
                                "name": "item:I821",
                                "value": "0.1"
                            },
                            {
                                "type": "setValue",
                                "name": "item:pickaxe",
                                "value": "1"
                            },
                            {
                                "type": "setValue",
                                "name": "item:centerFly",
                                "value": "1"
                            },
                            {
                                "type": "setValue",
                                "name": "item:bomb",
                                "value": "0"
                            },
                            {
                                "type": "changeFloor",
                                "floorId": "C1",
                                "loc": [
                                    1,
                                    5
                                ],
                                "direction": "right"
                            },
                            {
                                "type": "setValue",
                                "name": "item:I897",
                                "value": "1"
                            },
                            {
                                "type": "setValue",
                                "name": "item:I900",
                                "value": "1"
                            },
                            {
                                "type": "setValue",
                                "name": "item:I929",
                                "value": "1"
                            },
                            {
                                "type": "setValue",
                                "name": "item:I977",
                                "value": "1"
                            },
                            {
                                "type": "loadEquip",
                                "id": "I900"
                            },
                            {
                                "type": "loadEquip",
                                "id": "I929"
                            },
                            {
                                "type": "loadEquip",
                                "id": "I977"
                            },
                            {
                                "type": "follow",
                                "name": "nanami.png"
                            }
                        ]
                    },
                    {
                        "text": "第四心境",
                        "color": [
                            213,
                            132,
                            234,
                            1
                        ],
                        "_collapsed": true,
                        "action": [
                            {
                                "type": "insert",
                                "name": "清空状态"
                            },
                            {
                                "type": "insert",
                                "name": "进入心之境界"
                            },
                            {
                                "type": "setValue",
                                "name": "status:exp",
                                "value": "0"
                            },
                            {
                                "type": "setValue",
                                "name": "status:lv",
                                "value": "22"
                            },
                            {
                                "type": "setValue",
                                "name": "status:hp",
                                "value": "200e8"
                            },
                            {
                                "type": "setValue",
                                "name": "status:atk",
                                "value": "8e7"
                            },
                            {
                                "type": "setValue",
                                "name": "status:def",
                                "value": "8e7"
                            },
                            {
                                "type": "setValue",
                                "name": "status:mdef",
                                "value": "8e8"
                            },
                            {
                                "type": "setValue",
                                "name": "item:yellowKey",
                                "value": "12"
                            },
                            {
                                "type": "setValue",
                                "name": "item:blueKey",
                                "value": "5"
                            },
                            {
                                "type": "setValue",
                                "name": "item:redKey",
                                "value": "2"
                            },
                            {
                                "type": "setValue",
                                "name": "item:I821",
                                "value": "0.03"
                            },
                            {
                                "type": "setValue",
                                "name": "item:pickaxe",
                                "value": "3"
                            },
                            {
                                "type": "setValue",
                                "name": "item:centerFly",
                                "value": "3"
                            },
                            {
                                "type": "setValue",
                                "name": "item:bomb",
                                "value": "0"
                            },
                            {
                                "type": "changeFloor",
                                "floorId": "D1",
                                "loc": [
                                    11,
                                    11
                                ],
                                "direction": "left"
                            },
                            {
                                "type": "setValue",
                                "name": "item:I901",
                                "value": "1"
                            },
                            {
                                "type": "setValue",
                                "name": "item:I1124",
                                "value": "1"
                            },
                            {
                                "type": "setValue",
                                "name": "item:I930",
                                "value": "1"
                            },
                            {
                                "type": "setValue",
                                "name": "item:I977",
                                "value": "1"
                            },
                            {
                                "type": "loadEquip",
                                "id": "I901"
                            },
                            {
                                "type": "loadEquip",
                                "id": "I1124"
                            },
                            {
                                "type": "loadEquip",
                                "id": "I930"
                            },
                            {
                                "type": "loadEquip",
                                "id": "I977"
                            },
                            {
                                "type": "follow",
                                "name": "nanami.png"
                            }
                        ]
                    },
                    {
                        "text": "第五心境",
                        "color": [
                            233,
                            91,
                            159,
                            1
                        ],
                        "_collapsed": true,
                        "action": [
                            {
                                "type": "insert",
                                "name": "清空状态"
                            },
                            {
                                "type": "insert",
                                "name": "进入心之境界"
                            },
                            {
                                "type": "setValue",
                                "name": "status:exp",
                                "value": "0"
                            },
                            {
                                "type": "setValue",
                                "name": "status:lv",
                                "value": "24"
                            },
                            {
                                "type": "setValue",
                                "name": "status:hp",
                                "value": "550e8"
                            },
                            {
                                "type": "setValue",
                                "name": "status:atk",
                                "value": "5.5e8"
                            },
                            {
                                "type": "setValue",
                                "name": "status:def",
                                "value": "5.5e8"
                            },
                            {
                                "type": "setValue",
                                "name": "status:mdef",
                                "value": "55e8"
                            },
                            {
                                "type": "setValue",
                                "name": "item:yellowKey",
                                "value": "16"
                            },
                            {
                                "type": "setValue",
                                "name": "item:blueKey",
                                "value": "6"
                            },
                            {
                                "type": "setValue",
                                "name": "item:redKey",
                                "value": "3"
                            },
                            {
                                "type": "setValue",
                                "name": "item:greenKey",
                                "value": "0"
                            },
                            {
                                "type": "setValue",
                                "name": "item:pickaxe",
                                "value": "4"
                            },
                            {
                                "type": "setValue",
                                "name": "item:centerFly",
                                "value": "3"
                            },
                            {
                                "type": "setValue",
                                "name": "item:bomb",
                                "value": "0"
                            },
                            {
                                "type": "changeFloor",
                                "floorId": "E_1",
                                "loc": [
                                    11,
                                    0
                                ],
                                "direction": "down"
                            },
                            {
                                "type": "setValue",
                                "name": "item:I901",
                                "value": "1"
                            },
                            {
                                "type": "setValue",
                                "name": "item:I1125",
                                "value": "1"
                            },
                            {
                                "type": "setValue",
                                "name": "item:I931",
                                "value": "1"
                            },
                            {
                                "type": "setValue",
                                "name": "item:I977",
                                "value": "1"
                            },
                            {
                                "type": "loadEquip",
                                "id": "I901"
                            },
                            {
                                "type": "loadEquip",
                                "id": "I1125"
                            },
                            {
                                "type": "loadEquip",
                                "id": "I931"
                            },
                            {
                                "type": "loadEquip",
                                "id": "I977"
                            }
                        ]
                    },
                    {
                        "text": "第六心境",
                        "color": [
                            68,
                            230,
                            65,
                            1
                        ],
                        "_collapsed": true,
                        "action": [
                            {
                                "type": "insert",
                                "name": "清空状态"
                            },
                            {
                                "type": "insert",
                                "name": "进入心之境界"
                            },
                            {
                                "type": "setValue",
                                "name": "status:exp",
                                "value": "0"
                            },
                            {
                                "type": "setValue",
                                "name": "status:lv",
                                "value": "26"
                            },
                            {
                                "type": "setValue",
                                "name": "status:exp",
                                "value": "1.5e8"
                            },
                            {
                                "type": "setValue",
                                "name": "status:hp",
                                "value": "2e12"
                            },
                            {
                                "type": "setValue",
                                "name": "status:atk",
                                "value": "60e8"
                            },
                            {
                                "type": "setValue",
                                "name": "status:def",
                                "value": "90e8"
                            },
                            {
                                "type": "setValue",
                                "name": "status:mdef",
                                "value": "400e8"
                            },
                            {
                                "type": "setValue",
                                "name": "item:yellowKey",
                                "value": "9"
                            },
                            {
                                "type": "setValue",
                                "name": "item:blueKey",
                                "value": "6"
                            },
                            {
                                "type": "setValue",
                                "name": "item:redKey",
                                "value": "3"
                            },
                            {
                                "type": "setValue",
                                "name": "item:greenKey",
                                "value": "0"
                            },
                            {
                                "type": "setValue",
                                "name": "item:pickaxe",
                                "value": "3"
                            },
                            {
                                "type": "setValue",
                                "name": "item:centerFly",
                                "value": "2"
                            },
                            {
                                "type": "setValue",
                                "name": "item:I732",
                                "value": "1"
                            },
                            {
                                "type": "setValue",
                                "name": "item:I733",
                                "value": "1"
                            },
                            {
                                "type": "setValue",
                                "name": "item:bomb",
                                "value": "0"
                            },
                            {
                                "type": "changeFloor",
                                "floorId": "F1",
                                "loc": [
                                    5,
                                    11
                                ],
                                "direction": "up"
                            },
                            {
                                "type": "setValue",
                                "name": "item:I922",
                                "value": "1"
                            },
                            {
                                "type": "setValue",
                                "name": "item:I1125",
                                "value": "1"
                            },
                            {
                                "type": "setValue",
                                "name": "item:I933",
                                "value": "1"
                            },
                            {
                                "type": "setValue",
                                "name": "item:I978",
                                "value": "1"
                            },
                            {
                                "type": "loadEquip",
                                "id": "I922"
                            },
                            {
                                "type": "loadEquip",
                                "id": "I1125"
                            },
                            {
                                "type": "loadEquip",
                                "id": "I933"
                            },
                            {
                                "type": "loadEquip",
                                "id": "I978"
                            }
                        ]
                    },
                    {
                        "text": "第七心境",
                        "color": [
                            232,
                            17,
                            61,
                            1
                        ],
                        "_collapsed": true,
                        "action": [
                            {
                                "type": "insert",
                                "name": "清空状态"
                            },
                            {
                                "type": "insert",
                                "name": "进入心之境界"
                            },
                            {
                                "type": "setValue",
                                "name": "status:exp",
                                "value": "0"
                            },
                            {
                                "type": "setValue",
                                "name": "status:lv",
                                "value": "28"
                            },
                            {
                                "type": "setValue",
                                "name": "status:hp",
                                "value": "400e12"
                            },
                            {
                                "type": "setValue",
                                "name": "status:atk",
                                "value": "2100e8"
                            },
                            {
                                "type": "setValue",
                                "name": "status:def",
                                "value": "2100e8"
                            },
                            {
                                "type": "setValue",
                                "name": "status:mdef",
                                "value": "20000e8"
                            },
                            {
                                "type": "setValue",
                                "name": "item:yellowKey",
                                "value": "20"
                            },
                            {
                                "type": "setValue",
                                "name": "item:blueKey",
                                "value": "10"
                            },
                            {
                                "type": "setValue",
                                "name": "item:redKey",
                                "value": "4"
                            },
                            {
                                "type": "setValue",
                                "name": "item:greenKey",
                                "value": "0"
                            },
                            {
                                "type": "setValue",
                                "name": "item:pickaxe",
                                "value": "6"
                            },
                            {
                                "type": "setValue",
                                "name": "item:centerFly",
                                "value": "5"
                            },
                            {
                                "type": "setValue",
                                "name": "item:I732",
                                "value": "3"
                            },
                            {
                                "type": "setValue",
                                "name": "item:I733",
                                "value": "3"
                            },
                            {
                                "type": "setValue",
                                "name": "item:bomb",
                                "value": "0"
                            },
                            {
                                "type": "changeFloor",
                                "floorId": "G1",
                                "loc": [
                                    5,
                                    10
                                ],
                                "direction": "down"
                            },
                            {
                                "type": "setValue",
                                "name": "item:I923",
                                "value": "1"
                            },
                            {
                                "type": "setValue",
                                "name": "item:I1125",
                                "value": "1"
                            },
                            {
                                "type": "setValue",
                                "name": "item:I938",
                                "value": "1"
                            },
                            {
                                "type": "setValue",
                                "name": "item:I978",
                                "value": "1"
                            },
                            {
                                "type": "loadEquip",
                                "id": "I923"
                            },
                            {
                                "type": "loadEquip",
                                "id": "I1125"
                            },
                            {
                                "type": "loadEquip",
                                "id": "I938"
                            },
                            {
                                "type": "loadEquip",
                                "id": "I978"
                            }
                        ]
                    },
                    {
                        "text": "第八心境",
                        "color": [
                            0,
                            255,
                            189,
                            1
                        ],
                        "_collapsed": true,
                        "action": [
                            {
                                "type": "insert",
                                "name": "清空状态"
                            },
                            {
                                "type": "insert",
                                "name": "进入心之境界"
                            },
                            {
                                "type": "setValue",
                                "name": "status:exp",
                                "value": "0"
                            },
                            {
                                "type": "setValue",
                                "name": "status:lv",
                                "value": "30"
                            },
                            {
                                "type": "setValue",
                                "name": "status:hp",
                                "value": "2e16"
                            },
                            {
                                "type": "setValue",
                                "name": "status:atk",
                                "value": "27000e8"
                            },
                            {
                                "type": "setValue",
                                "name": "status:def",
                                "value": "27000e8"
                            },
                            {
                                "type": "setValue",
                                "name": "status:mdef",
                                "value": "200000e9"
                            },
                            {
                                "type": "setValue",
                                "name": "item:yellowKey",
                                "value": "15"
                            },
                            {
                                "type": "setValue",
                                "name": "item:blueKey",
                                "value": "9"
                            },
                            {
                                "type": "setValue",
                                "name": "item:redKey",
                                "value": "3"
                            },
                            {
                                "type": "setValue",
                                "name": "item:greenKey",
                                "value": "0"
                            },
                            {
                                "type": "setValue",
                                "name": "item:pickaxe",
                                "value": "6"
                            },
                            {
                                "type": "setValue",
                                "name": "item:centerFly",
                                "value": "4"
                            },
                            {
                                "type": "setValue",
                                "name": "item:I732",
                                "value": "3"
                            },
                            {
                                "type": "setValue",
                                "name": "item:I733",
                                "value": "2"
                            },
                            {
                                "type": "setValue",
                                "name": "item:bomb",
                                "value": "0"
                            },
                            {
                                "type": "changeFloor",
                                "floorId": "H1",
                                "loc": [
                                    1,
                                    11
                                ],
                                "direction": "right"
                            },
                            {
                                "type": "setValue",
                                "name": "item:I923",
                                "value": "1"
                            },
                            {
                                "type": "setValue",
                                "name": "item:I1125",
                                "value": "1"
                            },
                            {
                                "type": "setValue",
                                "name": "item:I939",
                                "value": "1"
                            },
                            {
                                "type": "setValue",
                                "name": "item:I978",
                                "value": "1"
                            },
                            {
                                "type": "loadEquip",
                                "id": "I923"
                            },
                            {
                                "type": "loadEquip",
                                "id": "I1125"
                            },
                            {
                                "type": "loadEquip",
                                "id": "I939"
                            },
                            {
                                "type": "loadEquip",
                                "id": "I978"
                            }
                        ]
                    },
                    {
                        "text": "进入更深层",
                        "color": [
                            223,
                            207,
                            208,
                            1
                        ],
                        "action": [
                            {
                                "type": "insert",
                                "loc": [
                                    6,
                                    6
                                ],
                                "floorId": "sample0"
                            }
                        ]
                    },
                    {
                        "text": "离去…",
                        "action": []
                    }
                ]
            }
        ],
        "6,6": [
            {
                "type": "choices",
                "text": "『纳可的心境』——独立于游戏外的挑战副本。\n它服务于不满足原作难度，希望挑战自我的玩家。\n请注意，背包里的心境之石可以降低难度。\n当主塔更新后，新的心境将会同步开启。",
                "choices": [
                    {
                        "text": "第九心境",
                        "color": [
                            229,
                            206,
                            120,
                            1
                        ],
                        "_collapsed": true,
                        "action": [
                            {
                                "type": "insert",
                                "name": "清空状态"
                            },
                            {
                                "type": "insert",
                                "name": "进入心之境界"
                            },
                            {
                                "type": "setValue",
                                "name": "item:I955",
                                "value": "1"
                            },
                            {
                                "type": "setValue",
                                "name": "flag:moon4",
                                "value": "1"
                            },
                            {
                                "type": "setValue",
                                "name": "status:lv",
                                "value": "32"
                            },
                            {
                                "type": "setValue",
                                "name": "status:money",
                                "value": "0"
                            },
                            {
                                "type": "setValue",
                                "name": "status:exp",
                                "value": "120e8"
                            },
                            {
                                "type": "setValue",
                                "name": "status:hp",
                                "value": "20e16"
                            },
                            {
                                "type": "setValue",
                                "name": "status:atk",
                                "value": "30e12"
                            },
                            {
                                "type": "setValue",
                                "name": "status:def",
                                "value": "30e12"
                            },
                            {
                                "type": "setValue",
                                "name": "status:mdef",
                                "value": "400e12"
                            },
                            {
                                "type": "setValue",
                                "name": "item:yellowKey",
                                "value": "28"
                            },
                            {
                                "type": "setValue",
                                "name": "item:blueKey",
                                "value": "14"
                            },
                            {
                                "type": "setValue",
                                "name": "item:redKey",
                                "value": "3"
                            },
                            {
                                "type": "setValue",
                                "name": "item:greenKey",
                                "value": "0"
                            },
                            {
                                "type": "setValue",
                                "name": "item:pickaxe",
                                "value": "5"
                            },
                            {
                                "type": "setValue",
                                "name": "item:centerFly",
                                "value": "4"
                            },
                            {
                                "type": "setValue",
                                "name": "item:I732",
                                "value": "2"
                            },
                            {
                                "type": "setValue",
                                "name": "item:I733",
                                "value": "2"
                            },
                            {
                                "type": "setValue",
                                "name": "item:bomb",
                                "value": "0"
                            },
                            {
                                "type": "setValue",
                                "name": "item:I1181",
                                "value": "1"
                            },
                            {
                                "type": "setValue",
                                "name": "item:I926",
                                "value": "1"
                            },
                            {
                                "type": "setValue",
                                "name": "item:I1126",
                                "value": "1"
                            },
                            {
                                "type": "setValue",
                                "name": "item:I935",
                                "value": "1"
                            },
                            {
                                "type": "setValue",
                                "name": "item:I945",
                                "value": "1"
                            },
                            {
                                "type": "setGlobalFlag",
                                "name": "s:enableMoney",
                                "value": true
                            },
                            {
                                "type": "loadEquip",
                                "id": "I926"
                            },
                            {
                                "type": "loadEquip",
                                "id": "I1126"
                            },
                            {
                                "type": "loadEquip",
                                "id": "I935"
                            },
                            {
                                "type": "loadEquip",
                                "id": "I1181"
                            },
                            {
                                "type": "changeFloor",
                                "floorId": "I1",
                                "loc": [
                                    0,
                                    6
                                ],
                                "direction": "right"
                            }
                        ]
                    },
                    {
                        "text": "第十心境",
                        "color": [
                            124,
                            126,
                            131,
                            1
                        ],
                        "_collapsed": true,
                        "action": [
                            {
                                "type": "insert",
                                "name": "清空状态"
                            },
                            {
                                "type": "insert",
                                "name": "进入心之境界"
                            },
                            {
                                "type": "setValue",
                                "name": "item:I955",
                                "value": "1"
                            },
                            {
                                "type": "setValue",
                                "name": "status:lv",
                                "value": "34"
                            },
                            {
                                "type": "setValue",
                                "name": "status:money",
                                "value": "300"
                            },
                            {
                                "type": "setValue",
                                "name": "status:exp",
                                "value": "250e8"
                            },
                            {
                                "type": "setValue",
                                "name": "status:hp",
                                "value": "120e16"
                            },
                            {
                                "type": "setValue",
                                "name": "status:atk",
                                "value": "90e12"
                            },
                            {
                                "type": "setValue",
                                "name": "status:def",
                                "value": "90e12"
                            },
                            {
                                "type": "setValue",
                                "name": "status:mdef",
                                "value": "1000e12"
                            },
                            {
                                "type": "setValue",
                                "name": "item:yellowKey",
                                "value": "14"
                            },
                            {
                                "type": "setValue",
                                "name": "item:blueKey",
                                "value": "4"
                            },
                            {
                                "type": "setValue",
                                "name": "item:redKey",
                                "value": "1"
                            },
                            {
                                "type": "setValue",
                                "name": "item:greenKey",
                                "value": "0"
                            },
                            {
                                "type": "setValue",
                                "name": "item:pickaxe",
                                "value": "5"
                            },
                            {
                                "type": "setValue",
                                "name": "item:centerFly",
                                "value": "4"
                            },
                            {
                                "type": "setValue",
                                "name": "item:I732",
                                "value": "3"
                            },
                            {
                                "type": "setValue",
                                "name": "item:I733",
                                "value": "0"
                            },
                            {
                                "type": "setValue",
                                "name": "item:bomb",
                                "value": "0"
                            },
                            {
                                "type": "setValue",
                                "name": "item:I1181",
                                "value": "1"
                            },
                            {
                                "type": "setValue",
                                "name": "item:I926",
                                "value": "1"
                            },
                            {
                                "type": "setValue",
                                "name": "item:I1127",
                                "value": "1"
                            },
                            {
                                "type": "setValue",
                                "name": "item:I936",
                                "value": "1"
                            },
                            {
                                "type": "setValue",
                                "name": "item:I1178",
                                "value": "1"
                            },
                            {
                                "type": "setValue",
                                "name": "item:I1476",
                                "value": "1"
                            },
                            {
                                "type": "setValue",
                                "name": "item:I945",
                                "value": "1"
                            },
                            {
                                "type": "setGlobalFlag",
                                "name": "s:enableMoney",
                                "value": true
                            },
                            {
                                "type": "loadEquip",
                                "id": "I926"
                            },
                            {
                                "type": "loadEquip",
                                "id": "I1127"
                            },
                            {
                                "type": "loadEquip",
                                "id": "I936"
                            },
                            {
                                "type": "loadEquip",
                                "id": "I1178"
                            },
                            {
                                "type": "loadEquip",
                                "id": "I1476"
                            },
                            {
                                "type": "loadEquip",
                                "id": "I1181"
                            },
                            {
                                "type": "changeFloor",
                                "floorId": "J1",
                                "loc": [
                                    6,
                                    7
                                ],
                                "direction": "down"
                            }
                        ]
                    },
                    {
                        "text": "十一心境",
                        "color": [
                            221,
                            103,
                            76,
                            1
                        ],
                        "_collapsed": true,
                        "action": [
                            {
                                "type": "insert",
                                "name": "清空状态"
                            },
                            {
                                "type": "insert",
                                "name": "进入心之境界"
                            },
                            {
                                "type": "setValue",
                                "name": "item:I955",
                                "value": "1"
                            },
                            {
                                "type": "setValue",
                                "name": "status:lv",
                                "value": "34"
                            },
                            {
                                "type": "setValue",
                                "name": "status:money",
                                "value": "1000"
                            },
                            {
                                "type": "setValue",
                                "name": "status:exp",
                                "value": "890e8"
                            },
                            {
                                "type": "setValue",
                                "name": "status:hp",
                                "value": "1200e16"
                            },
                            {
                                "type": "setValue",
                                "name": "status:atk",
                                "value": "440e12"
                            },
                            {
                                "type": "setValue",
                                "name": "status:def",
                                "value": "460e12"
                            },
                            {
                                "type": "setValue",
                                "name": "status:mdef",
                                "value": "7500e12"
                            },
                            {
                                "type": "setValue",
                                "name": "item:yellowKey",
                                "value": "16"
                            },
                            {
                                "type": "setValue",
                                "name": "item:blueKey",
                                "value": "8"
                            },
                            {
                                "type": "setValue",
                                "name": "item:redKey",
                                "value": "4"
                            },
                            {
                                "type": "setValue",
                                "name": "item:greenKey",
                                "value": "0"
                            },
                            {
                                "type": "setValue",
                                "name": "item:pickaxe",
                                "value": "6"
                            },
                            {
                                "type": "setValue",
                                "name": "item:centerFly",
                                "value": "4"
                            },
                            {
                                "type": "setValue",
                                "name": "item:I732",
                                "value": "2"
                            },
                            {
                                "type": "setValue",
                                "name": "item:I733",
                                "value": "4"
                            },
                            {
                                "type": "setValue",
                                "name": "item:bomb",
                                "value": "0"
                            },
                            {
                                "type": "setValue",
                                "name": "item:I1449",
                                "value": "1"
                            },
                            {
                                "type": "setValue",
                                "name": "item:I1476",
                                "value": "1"
                            },
                            {
                                "type": "setValue",
                                "name": "item:I927",
                                "value": "1"
                            },
                            {
                                "type": "setValue",
                                "name": "item:I1127",
                                "value": "1"
                            },
                            {
                                "type": "setValue",
                                "name": "item:I1178",
                                "value": "1"
                            },
                            {
                                "type": "setValue",
                                "name": "item:I934",
                                "value": "1"
                            },
                            {
                                "type": "setValue",
                                "name": "item:I945",
                                "value": "1"
                            },
                            {
                                "type": "setGlobalFlag",
                                "name": "s:enableMoney",
                                "value": true
                            },
                            {
                                "type": "loadEquip",
                                "id": "I927"
                            },
                            {
                                "type": "loadEquip",
                                "id": "I1178"
                            },
                            {
                                "type": "loadEquip",
                                "id": "I1476"
                            },
                            {
                                "type": "loadEquip",
                                "id": "I1449"
                            },
                            {
                                "type": "loadEquip",
                                "id": "I1127"
                            },
                            {
                                "type": "loadEquip",
                                "id": "I934"
                            },
                            {
                                "type": "changeFloor",
                                "floorId": "K1",
                                "loc": [
                                    11,
                                    11
                                ],
                                "direction": "left"
                            }
                        ]
                    },
                    {
                        "text": "十二心境",
                        "color": [
                            135,
                            182,
                            231,
                            1
                        ],
                        "_collapsed": true,
                        "action": [
                            {
                                "type": "insert",
                                "name": "清空状态"
                            },
                            {
                                "type": "insert",
                                "name": "进入心之境界"
                            },
                            {
                                "type": "setValue",
                                "name": "item:I955",
                                "value": "1"
                            },
                            {
                                "type": "setValue",
                                "name": "flag:magicAtk",
                                "value": "1"
                            },
                            {
                                "type": "setValue",
                                "name": "item:I1491",
                                "value": "1"
                            },
                            {
                                "type": "setValue",
                                "name": "status:lv",
                                "value": "36"
                            },
                            {
                                "type": "setValue",
                                "name": "status:money",
                                "value": "2000"
                            },
                            {
                                "type": "setValue",
                                "name": "status:exp",
                                "value": "0"
                            },
                            {
                                "type": "setValue",
                                "name": "status:hp",
                                "value": "20000e16"
                            },
                            {
                                "type": "setValue",
                                "name": "status:atk",
                                "value": "14e15"
                            },
                            {
                                "type": "setValue",
                                "name": "status:def",
                                "value": "14e15"
                            },
                            {
                                "type": "setValue",
                                "name": "status:mdef",
                                "value": "18e16"
                            },
                            {
                                "type": "setValue",
                                "name": "item:yellowKey",
                                "value": "8"
                            },
                            {
                                "type": "setValue",
                                "name": "item:blueKey",
                                "value": "8"
                            },
                            {
                                "type": "setValue",
                                "name": "item:redKey",
                                "value": "2"
                            },
                            {
                                "type": "setValue",
                                "name": "item:greenKey",
                                "value": "0"
                            },
                            {
                                "type": "setValue",
                                "name": "item:pickaxe",
                                "value": "4"
                            },
                            {
                                "type": "setValue",
                                "name": "item:centerFly",
                                "value": "3"
                            },
                            {
                                "type": "setValue",
                                "name": "item:I732",
                                "value": "3"
                            },
                            {
                                "type": "setValue",
                                "name": "item:I733",
                                "value": "1"
                            },
                            {
                                "type": "setValue",
                                "name": "item:I1449",
                                "value": "1"
                            },
                            {
                                "type": "setValue",
                                "name": "item:I1697",
                                "value": "1"
                            },
                            {
                                "type": "setValue",
                                "name": "item:I927",
                                "value": "1"
                            },
                            {
                                "type": "setValue",
                                "name": "item:I1740",
                                "value": "1"
                            },
                            {
                                "type": "setValue",
                                "name": "item:I1175",
                                "value": "1"
                            },
                            {
                                "type": "setValue",
                                "name": "item:I1723",
                                "value": "1"
                            },
                            {
                                "type": "setValue",
                                "name": "item:I945",
                                "value": "1"
                            },
                            {
                                "type": "setGlobalFlag",
                                "name": "s:enableMoney",
                                "value": true
                            },
                            {
                                "type": "loadEquip",
                                "id": "I927"
                            },
                            {
                                "type": "loadEquip",
                                "id": "I1697"
                            },
                            {
                                "type": "loadEquip",
                                "id": "I1740"
                            },
                            {
                                "type": "loadEquip",
                                "id": "I1449"
                            },
                            {
                                "type": "loadEquip",
                                "id": "I1175"
                            },
                            {
                                "type": "loadEquip",
                                "id": "I1723"
                            },
                            {
                                "type": "changeFloor",
                                "floorId": "L1",
                                "loc": [
                                    6,
                                    3
                                ],
                                "direction": "down"
                            }
                        ]
                    },
                    {
                        "text": "十三心境",
                        "color": [
                            196,
                            203,
                            101,
                            1
                        ],
                        "_collapsed": true,
                        "action": [
                            {
                                "type": "insert",
                                "name": "清空状态"
                            },
                            {
                                "type": "insert",
                                "name": "进入心之境界"
                            },
                            {
                                "type": "setValue",
                                "name": "flag:magicAtk",
                                "value": "1"
                            },
                            {
                                "type": "setValue",
                                "name": "flag:wlzt",
                                "value": "1"
                            },
                            {
                                "type": "setValue",
                                "name": "item:I1492",
                                "value": "1"
                            },
                            {
                                "type": "setValue",
                                "name": "status:lv",
                                "value": "40"
                            },
                            {
                                "type": "setValue",
                                "name": "flag:newlv",
                                "value": "1"
                            },
                            {
                                "type": "setValue",
                                "name": "status:money",
                                "value": "2000"
                            },
                            {
                                "type": "setValue",
                                "name": "status:exp",
                                "value": "2000e8"
                            },
                            {
                                "type": "setValue",
                                "name": "status:hp",
                                "value": "50e20"
                            },
                            {
                                "type": "setValue",
                                "name": "status:atk",
                                "value": "9e16"
                            },
                            {
                                "type": "setValue",
                                "name": "status:def",
                                "value": "9e16"
                            },
                            {
                                "type": "setValue",
                                "name": "status:mdef",
                                "value": "120e16"
                            },
                            {
                                "type": "setValue",
                                "name": "item:yellowKey",
                                "value": "24"
                            },
                            {
                                "type": "setValue",
                                "name": "item:blueKey",
                                "value": "8"
                            },
                            {
                                "type": "setValue",
                                "name": "item:redKey",
                                "value": "3"
                            },
                            {
                                "type": "setValue",
                                "name": "item:greenKey",
                                "value": "0"
                            },
                            {
                                "type": "setValue",
                                "name": "item:pickaxe",
                                "value": "4"
                            },
                            {
                                "type": "setValue",
                                "name": "item:centerFly",
                                "value": "3"
                            },
                            {
                                "type": "setValue",
                                "name": "item:I732",
                                "value": "1"
                            },
                            {
                                "type": "setValue",
                                "name": "item:I733",
                                "value": "1"
                            },
                            {
                                "type": "setValue",
                                "name": "item:I1782",
                                "value": "1"
                            },
                            {
                                "type": "setValue",
                                "name": "item:I1697",
                                "value": "1"
                            },
                            {
                                "type": "setValue",
                                "name": "item:I1699",
                                "value": "1"
                            },
                            {
                                "type": "setValue",
                                "name": "item:I1776",
                                "value": "1"
                            },
                            {
                                "type": "setValue",
                                "name": "item:I1175",
                                "value": "1"
                            },
                            {
                                "type": "setValue",
                                "name": "item:I1723",
                                "value": "1"
                            },
                            {
                                "type": "setValue",
                                "name": "item:I945",
                                "value": "1"
                            },
                            {
                                "type": "loadEquip",
                                "id": "I1699"
                            },
                            {
                                "type": "loadEquip",
                                "id": "I1697"
                            },
                            {
                                "type": "loadEquip",
                                "id": "I1776"
                            },
                            {
                                "type": "loadEquip",
                                "id": "I1782"
                            },
                            {
                                "type": "loadEquip",
                                "id": "I1175"
                            },
                            {
                                "type": "loadEquip",
                                "id": "I1723"
                            },
                            {
                                "type": "changeFloor",
                                "floorId": "M1",
                                "loc": [
                                    1,
                                    11
                                ],
                                "direction": "right"
                            }
                        ]
                    },
                    {
                        "text": "十四心境",
                        "color": [
                            42,
                            205,
                            36,
                            1
                        ],
                        "action": [
                            {
                                "type": "insert",
                                "name": "清空状态"
                            },
                            {
                                "type": "insert",
                                "name": "进入心之境界"
                            },
                            {
                                "type": "setValue",
                                "name": "item:I955",
                                "value": "1"
                            },
                            {
                                "type": "setValue",
                                "name": "flag:magicAtk",
                                "value": "1"
                            },
                            {
                                "type": "setValue",
                                "name": "item:I1492",
                                "value": "1"
                            },
                            {
                                "type": "setValue",
                                "name": "status:lv",
                                "value": "42"
                            },
                            {
                                "type": "setValue",
                                "name": "flag:newlv",
                                "value": "3"
                            },
                            {
                                "type": "setValue",
                                "name": "status:money",
                                "value": "30000"
                            },
                            {
                                "type": "setValue",
                                "name": "status:exp",
                                "value": "12000e8"
                            },
                            {
                                "type": "setValue",
                                "name": "status:hp",
                                "value": "240e20"
                            },
                            {
                                "type": "setValue",
                                "name": "status:atk",
                                "value": "60e16"
                            },
                            {
                                "type": "setValue",
                                "name": "status:def",
                                "value": "60e16"
                            },
                            {
                                "type": "setValue",
                                "name": "status:mdef",
                                "value": "600e16"
                            },
                            {
                                "type": "setValue",
                                "name": "item:I1788",
                                "value": "2"
                            },
                            {
                                "type": "setValue",
                                "name": "item:yellowKey",
                                "value": "0"
                            },
                            {
                                "type": "setValue",
                                "name": "item:blueKey",
                                "value": "0"
                            },
                            {
                                "type": "setValue",
                                "name": "item:redKey",
                                "value": "0"
                            },
                            {
                                "type": "setValue",
                                "name": "item:greenKey",
                                "value": "0"
                            },
                            {
                                "type": "setValue",
                                "name": "item:pickaxe",
                                "value": "4"
                            },
                            {
                                "type": "setValue",
                                "name": "item:centerFly",
                                "value": "4"
                            },
                            {
                                "type": "setValue",
                                "name": "item:I732",
                                "value": "2"
                            },
                            {
                                "type": "setValue",
                                "name": "item:I733",
                                "value": "3"
                            },
                            {
                                "type": "setValue",
                                "name": "item:I1782",
                                "value": "1"
                            },
                            {
                                "type": "setValue",
                                "name": "item:I1697",
                                "value": "1"
                            },
                            {
                                "type": "setValue",
                                "name": "item:I1699",
                                "value": "1"
                            },
                            {
                                "type": "setValue",
                                "name": "item:I1776",
                                "value": "1"
                            },
                            {
                                "type": "setValue",
                                "name": "item:I1175",
                                "value": "1"
                            },
                            {
                                "type": "setValue",
                                "name": "item:I943",
                                "value": "1"
                            },
                            {
                                "type": "setValue",
                                "name": "item:I945",
                                "value": "1"
                            },
                            {
                                "type": "loadEquip",
                                "id": "I1699"
                            },
                            {
                                "type": "loadEquip",
                                "id": "I1697"
                            },
                            {
                                "type": "loadEquip",
                                "id": "I1776"
                            },
                            {
                                "type": "loadEquip",
                                "id": "I1782"
                            },
                            {
                                "type": "loadEquip",
                                "id": "I1175"
                            },
                            {
                                "type": "loadEquip",
                                "id": "I943"
                            },
                            {
                                "type": "setGlobalFlag",
                                "name": "s:enableMoney",
                                "value": true
                            },
                            {
                                "type": "changeFloor",
                                "floorId": "N1",
                                "loc": [
                                    11,
                                    12
                                ],
                                "direction": "up"
                            }
                        ]
                    }
                ]
            }
        ],
        "7,10": [
            "你可以通过\r[lime]关闭临界显示\r，\n来流畅地浏览从第一层到最后一层的地图。\n\nPC端按\r[yellow]左下角第二行第三个按钮\r，\n手机端按\r[yellow]下边栏最右侧的按钮\r，\n可以打开\r[gold]功能页面\r。\n\n第一个选项为\r[lime]系统设置\r，\n第三个选项则为\r[lime]浏览地图\r。\n\n之后依次按\r[#66CCFF]系统设置→显示设置→临界显伤\r，\n即可关闭临界显示。\n此时便不再存在\r[gray]临界值过高导致的卡顿问题\r，\n可以流畅地进行浏览了。"
        ]
    },
    "changeFloor": {
        "6,0": {
            "floorId": "sample1",
            "stair": "downFloor"
        },
        "0,11": {
            "floorId": "sample0",
            "loc": [
                0,
                12
            ]
        },
        "0,12": {
            "floorId": "sample0",
            "stair": "upFloor"
        },
        "1,12": {
            "floorId": "sample0",
            "loc": [
                1,
                12
            ]
        },
        "2,12": {
            "floorId": "sample0",
            "loc": [
                2,
                12
            ]
        },
        "3,12": {
            "floorId": "sample0",
            "loc": [
                6,
                1
            ],
            "direction": "up"
        },
        "4,12": {
            "floorId": "sample0",
            "loc": [
                0,
                9
            ],
            "direction": "left",
            "time": 1000
        },
        "5,12": {
            "floorId": "sample0",
            "loc": [
                6,
                10
            ],
            "time": 0,
            "portalWithoutTrigger": false
        },
        "6,12": {
            "floorId": "sample0",
            "loc": [
                10,
                10
            ],
            "direction": "left",
            "time": 1000
        }
    },
    "afterBattle": {
        "2,6": [
            "\t[ghostSoldier]\b[this]不可能，你怎么可能打败我！\n（一个打败怪物触发的事件）"
        ],
        "0,9": [
            "这是一个高度为 48 个像素而非 32 个像素的敌人。\n高敌人的素材存放在 materials 文件夹中 enemy48.png 的部分。"
        ]
    },
    "afterGetItem": {
        "9,1": [
            "技能的支持需要依赖状态栏的“魔力”以及脚本编辑的“按键处理”，详见帮助文档“个性化”一节。"
        ],
        "12,2": [
            "跳跃靴和支援怪的跳跃音效是用脚本额外添加的，\n如果想为任意跳跃指令添加音效，请查阅帮助文档中的“脚本——复写函数”章节。"
        ],
        "8,3": [
            "炸弹是只能炸面前的怪物还是四个甚至八个方向的怪物，\n由其图块属性（快捷键C）中的“使用效果”决定。\n不能被炸的怪物请直接在该怪物的图块属性中勾选“不可炸”，\n可参见样板里黑衣魔王和黑暗大法师的写法。\nV2.8.1起，炸弹炸怪可以添加获得金经/触发战后事件，详见其使用效果中的注释。"
        ],
        "10,3": [
            "“上楼”和“下楼”的目标层由全塔属性（快捷键B）的“楼层列表”顺序所决定。"
        ],
        "12,3": [
            "如果想制作类似于生命魔杖等可以被批量使用的道具，请参照生命魔杖图块属性（快捷键B）中\n useItemEvent 的写法。\n其基本原理就是使用【接受用户输入】让玩家在弹窗中输入想要使用的物品数量，再判断玩家的输入是否合法，如果输入合法就扣减相应数量的物品并结算物品效果。\n要注意的是，在使用物品时会先消耗一个物品，所以记得在编辑 useItemEvent 时先用 core.addItem 恢复一个物品。"
        ],
        "9,4": [
            "装备的种类由全塔属性（快捷键B）中的“装备孔”决定。\n每件装备的“类型”就是在“装备孔”中的索引，例如默认情况下 0 代表武器。\n同时，只有第一个装备孔中的装备，其“普攻动画”属性才会生效。"
        ],
        "10,4": [
            "每层楼的“可楼传”勾选框决定了该楼层能否被飞到。\n\n勇士在不能被飞到的楼层也无法使用楼层传送器。",
            "飞行的楼层顺序由全塔属性（快捷键B）中的“楼层列表”所决定。\n\n是否必须在楼梯边使用楼传器由全塔属性中的系统开关所决定。"
        ],
        "11,4": [
            "破墙镐是破面前的墙壁还是四个方向的墙壁，由其图块属性（快捷键C）的“使用效果”决定。\n哪些图块（怪物和道具除外）可以被破震，由该图块的图块属性中的“可破震”决定。"
        ],
        "12,4": [
            "在 2.8.1 版更新后，能够被破冰镐摧毁的冰块被移动到了 animates 下。\n如果想制作一个可以以特定触发器的方式移除特定图块的道具，可以参照破冰镐物品图块属性中\n useItemEffect 和 canUseItemEffect 的写法。"
        ],
        "11,8": [
            "由于状态栏放不下，铁门钥匙（根据全塔属性的系统开关勾选与否，可能还有绿钥匙）会被放入道具栏中。\n碰到绿门和铁门时仍然会自动使用钥匙开门。"
        ],
        "12,8": [
            "该道具默认是大黄门钥匙，如需改为钥匙盒直接修改其图块属性（快捷键C）的“道具类别”为items即可。"
        ],
        "8,7": [
            "如需修改消耗品的效果，请前往全塔属性（快捷键B），找到并修改values（全局数值）内对应的具体数值即可。\n如果有高级的需求（如每个区域宝石数值变化），请修改楼层属性（快捷键V）最下方的“宝石血瓶效果”。\n如果有更高级的需求，请查阅帮助文档。"
        ],
        "11,7": [
            "与大黄门钥匙类似的是，如果将黄宝石的图块属性设为 items ，那么黄宝石将在被拾取触发 itemEffect 效果。\n\n注意：触碰或使用事件（useItemEvent）对 items、tools、constants 都有效。\n这意味着，如果黄宝石的图块属性为 items ，那么在拾取黄宝石时，黄宝石不会进入背包，并且其“即捡即用”和“触碰或使用事件”都会被触发。"
        ],
        "12,7": [
            "由于吸血、夹击、净化等属性值的存在，玩家可能希望自动寻路时能尽量绕开血瓶和绿宝石。\n他们可以自行在游戏设置中开关这一功能。"
        ],
        "8,4": [
            "剑盾的道具类别设为equips才可以装备，\n如果设为items则会直接增加属性。",
            "在全塔属性（快捷键B）的系统开关中设置是否启用装备栏按钮。\n如果启用则装备栏按钮会替代楼传按钮。\n无论是否启用，玩家都可以双击道具栏按钮呼出装备栏。"
        ]
    },
    "afterOpenDoor": {
        "11,12": [
            "你打开了一扇绿门，触发了一个 afterOpenDoor 事件。"
        ],
        "10,6": [
            "这是一扇高度为 48 个像素而非 32 个像素的门。\n高门和高NPC的素材存放在 materials 文件夹中 npc48.png 的部分。"
        ]
    },
    "cannotMove": {},
    "bgmap": [

],
    "fgmap": [
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,10169,  0,10177,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,10170,  0,10185,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,10169,  0,10179,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,10172,  0,10180,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,10186,  0,10181,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,10187,  0,10182,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,10188,  0,10183,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0]
],
    "width": 13,
    "height": 13,
    "autoEvent": {},
    "beforeBattle": {},
    "cannotMoveIn": {},
    "cannotViewMap": true,
    "bg2map": [

],
    "fg2map": [

]
}
main.floors.JC19=
{
    "floorId": "JC19",
    "title": "基础 19 层",
    "name": "基础 19 层",
    "width": 13,
    "height": 13,
    "canFlyTo": true,
    "canFlyFrom": true,
    "canUseQuickShop": true,
    "cannotViewMap": false,
    "images": [],
    "ratio": 1,
    "defaultGround": 30060,
    "bgm": "j1.mp3",
    "firstArrive": [
        {
            "type": "if",
            "condition": "(flag:jc19f5==1)",
            "true": [],
            "false": [
                {
                    "type": "function",
                    "function": "function(){\ncore.setFlag(\"__visited__\", {});\n}"
                },
                {
                    "type": "changePos",
                    "direction": "down"
                },
                {
                    "type": "hide",
                    "loc": [
                        [
                            6,
                            0
                        ]
                    ],
                    "remove": true
                },
                {
                    "type": "animate",
                    "name": "jingya",
                    "loc": [
                        6,
                        2
                    ]
                },
                {
                    "type": "if",
                    "condition": "(item:superPotion==1)",
                    "true": [
                        "\t[屑猫头]居、居然真的留圣水通关了？！\n这太强了，看来基础教程已经不适合你了！\n来，这两把绿钥匙先收下。",
                        {
                            "type": "setValue",
                            "name": "item:greenKey",
                            "operator": "+=",
                            "value": "2"
                        },
                        "\t[屑猫头]你的圣水我就带走了！\n谁让你在第 5 层拿喵的绿钥匙呢！",
                        {
                            "type": "setValue",
                            "name": "item:superPotion",
                            "value": "0"
                        }
                    ],
                    "false": [
                        {
                            "type": "setValue",
                            "name": "flag:saltygreen",
                            "operator": "+=",
                            "value": "2"
                        },
                        "\t[屑猫头]居、居然真的通关了？！\n那个养殖者可是超喵卡血噩梦怪……\n咳咳，本喵勉强承认你有点拆塔天分嘛。"
                    ]
                },
                "\t[屑猫头]呼……从基本的回合制开始，\n到复杂的道具、钥匙和属性联立转换……\n看在你听喵讲了这么多的份上，算你完美通过啦。",
                "\t[屑猫头]看到下面这五座\r[#FFD700]「试炼塔」\r了没？\n这些就当作可做可不做的课后作业啦。\n对于新人，每座能只用\r[lime]一绿\r通关就已经非常不错。",
                "\t[屑猫头]ฅ \r[#edae9c]一点区域 血洛缘起\r 基本的血瓶先后顺序处理。\nฅ \r[#9cedb2]二点区域 琉璃虹彩\r 带有大量宝石的复杂转换。\nฅ \r[#b2c0d1]三点区域 枢机网络\r 钥匙、路线规划和资源统筹。\nฅ \r[#5aede3]四点区域 千钧一发\r 含有道具和各种抉择点。",
                "\t[屑猫头]ฅ 还有正中间的\r[#ed865a] 五点区域 满天星\r…\n喵忘记是干什么的了。嗯，要不你去撞一下？\n等活着回来就知道是什么啦。",
                "\t[屑猫头]差不多刷完这些塔以后，\n就来下一层找本喵结算分数吧。",
                {
                    "type": "setValue",
                    "name": "flag:jc19f5",
                    "value": "1"
                },
                {
                    "type": "hide",
                    "loc": [
                        [
                            6,
                            2
                        ]
                    ],
                    "remove": true,
                    "time": 500
                },
                "实战层计分方式：生命/10。",
                {
                    "type": "setValue",
                    "name": "status:hp",
                    "operator": "/=",
                    "value": "10"
                }
            ]
        }
    ],
    "eachArrive": [],
    "parallelDo": "",
    "events": {
        "1,9": [
            {
                "type": "choices",
                "text": "\t[试炼 S1,I1486]试炼一 - 血洛缘起",
                "choices": [
                    {
                        "text": "进入关卡",
                        "action": [
                            {
                                "type": "setValue",
                                "name": "flag:allhp",
                                "value": "status:hp"
                            },
                            {
                                "type": "setValue",
                                "name": "flag:nowatk",
                                "value": "status:atk"
                            },
                            {
                                "type": "setValue",
                                "name": "flag:nowdef",
                                "value": "status:def"
                            },
                            {
                                "type": "setValue",
                                "name": "flag:nowmdef",
                                "value": "status:mdef"
                            },
                            {
                                "type": "setValue",
                                "name": "flag:nowexp",
                                "value": "status:exp"
                            },
                            {
                                "type": "setValue",
                                "name": "flag:nowlevel",
                                "value": "status:lv"
                            },
                            {
                                "type": "unloadEquip",
                                "pos": 0
                            },
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
                                "name": "item:I893",
                                "value": "0"
                            },
                            {
                                "type": "setValue",
                                "name": "item:I894",
                                "value": "0"
                            },
                            {
                                "type": "setValue",
                                "name": "item:I895",
                                "value": "0"
                            },
                            {
                                "type": "setValue",
                                "name": "item:I897",
                                "value": "0"
                            },
                            {
                                "type": "changeFloor",
                                "floorId": "TS11",
                                "loc": [
                                    6,
                                    1
                                ],
                                "direction": "down"
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
        "3,9": [
            {
                "type": "choices",
                "text": "\t[试炼 S2,I642]试炼二 - 琉璃虹彩",
                "choices": [
                    {
                        "text": "进入关卡",
                        "action": [
                            {
                                "type": "setValue",
                                "name": "flag:allhp",
                                "value": "status:hp"
                            },
                            {
                                "type": "setValue",
                                "name": "flag:nowatk",
                                "value": "status:atk"
                            },
                            {
                                "type": "setValue",
                                "name": "flag:nowdef",
                                "value": "status:def"
                            },
                            {
                                "type": "setValue",
                                "name": "flag:nowmdef",
                                "value": "status:mdef"
                            },
                            {
                                "type": "unloadEquip",
                                "pos": 0
                            },
                            {
                                "type": "insert",
                                "name": "清空状态"
                            },
                            {
                                "type": "setValue",
                                "name": "status:lv",
                                "value": "10"
                            },
                            {
                                "type": "setValue",
                                "name": "status:exp",
                                "value": "57500"
                            },
                            {
                                "type": "setValue",
                                "name": "status:hp",
                                "value": "600000"
                            },
                            {
                                "type": "setValue",
                                "name": "status:atk",
                                "value": "5000"
                            },
                            {
                                "type": "setValue",
                                "name": "status:def",
                                "value": "5000"
                            },
                            {
                                "type": "setValue",
                                "name": "status:mdef",
                                "value": "60000"
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
                                "name": "item:I893",
                                "value": "0"
                            },
                            {
                                "type": "setValue",
                                "name": "item:I894",
                                "value": "0"
                            },
                            {
                                "type": "setValue",
                                "name": "item:I895",
                                "value": "0"
                            },
                            {
                                "type": "setValue",
                                "name": "item:I897",
                                "value": "0"
                            },
                            {
                                "type": "changeFloor",
                                "floorId": "TS21",
                                "loc": [
                                    6,
                                    0
                                ],
                                "direction": "down"
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
        "9,9": [
            {
                "type": "choices",
                "text": "\t[试炼 S3,redKey]试炼三 - 枢机网络",
                "choices": [
                    {
                        "text": "进入关卡",
                        "action": [
                            {
                                "type": "setValue",
                                "name": "flag:allhp",
                                "value": "status:hp"
                            },
                            {
                                "type": "setValue",
                                "name": "flag:nowatk",
                                "value": "status:atk"
                            },
                            {
                                "type": "setValue",
                                "name": "flag:nowdef",
                                "value": "status:def"
                            },
                            {
                                "type": "setValue",
                                "name": "flag:nowmdef",
                                "value": "status:mdef"
                            },
                            {
                                "type": "unloadEquip",
                                "pos": 0
                            },
                            {
                                "type": "insert",
                                "name": "清空状态"
                            },
                            {
                                "type": "setValue",
                                "name": "status:lv",
                                "value": "14"
                            },
                            {
                                "type": "setValue",
                                "name": "status:exp",
                                "value": "240000"
                            },
                            {
                                "type": "setValue",
                                "name": "status:hp",
                                "value": "128000000"
                            },
                            {
                                "type": "setValue",
                                "name": "status:atk",
                                "value": "630000"
                            },
                            {
                                "type": "setValue",
                                "name": "status:def",
                                "value": "630000"
                            },
                            {
                                "type": "setValue",
                                "name": "status:mdef",
                                "value": "6300000"
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
                                "name": "item:I893",
                                "value": "0"
                            },
                            {
                                "type": "setValue",
                                "name": "item:I894",
                                "value": "0"
                            },
                            {
                                "type": "setValue",
                                "name": "item:I895",
                                "value": "0"
                            },
                            {
                                "type": "setValue",
                                "name": "item:I897",
                                "value": "0"
                            },
                            {
                                "type": "changeFloor",
                                "floorId": "TS31",
                                "loc": [
                                    6,
                                    1
                                ],
                                "direction": "down"
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
        "11,9": [
            {
                "type": "choices",
                "text": "\t[试炼 S4,pickaxe]试炼四 - 千钧一发",
                "choices": [
                    {
                        "text": "进入关卡",
                        "action": [
                            {
                                "type": "setValue",
                                "name": "flag:allhp",
                                "value": "status:hp"
                            },
                            {
                                "type": "setValue",
                                "name": "flag:nowatk",
                                "value": "status:atk"
                            },
                            {
                                "type": "setValue",
                                "name": "flag:nowdef",
                                "value": "status:def"
                            },
                            {
                                "type": "setValue",
                                "name": "flag:nowmdef",
                                "value": "status:mdef"
                            },
                            {
                                "type": "unloadEquip",
                                "pos": 0
                            },
                            {
                                "type": "insert",
                                "name": "清空状态"
                            },
                            {
                                "type": "setValue",
                                "name": "status:lv",
                                "value": "24"
                            },
                            {
                                "type": "setValue",
                                "name": "status:exp",
                                "value": "27000000"
                            },
                            {
                                "type": "setValue",
                                "name": "status:hp",
                                "value": "2500e8"
                            },
                            {
                                "type": "setValue",
                                "name": "status:atk",
                                "value": "6.4e8"
                            },
                            {
                                "type": "setValue",
                                "name": "status:def",
                                "value": "6.4e8"
                            },
                            {
                                "type": "setValue",
                                "name": "status:mdef",
                                "value": "72e8"
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
                                "name": "item:I893",
                                "value": "0"
                            },
                            {
                                "type": "setValue",
                                "name": "item:I894",
                                "value": "0"
                            },
                            {
                                "type": "setValue",
                                "name": "item:I895",
                                "value": "0"
                            },
                            {
                                "type": "setValue",
                                "name": "item:I897",
                                "value": "0"
                            },
                            {
                                "type": "changeFloor",
                                "floorId": "TS41",
                                "loc": [
                                    6,
                                    9
                                ],
                                "direction": "up"
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
        "6,10": [
            {
                "type": "choices",
                "text": "\t[试炼 S5,X170409]试炼五 - 满天星",
                "choices": [
                    {
                        "text": "进入关卡",
                        "action": [
                            {
                                "type": "setValue",
                                "name": "flag:allhp",
                                "value": "status:hp"
                            },
                            {
                                "type": "setValue",
                                "name": "flag:nowatk",
                                "value": "status:atk"
                            },
                            {
                                "type": "setValue",
                                "name": "flag:nowdef",
                                "value": "status:def"
                            },
                            {
                                "type": "setValue",
                                "name": "flag:nowmdef",
                                "value": "status:mdef"
                            },
                            {
                                "type": "setValue",
                                "name": "flag:nowexp",
                                "value": "status:exp"
                            },
                            {
                                "type": "setValue",
                                "name": "flag:nowlevel",
                                "value": "status:lv"
                            },
                            {
                                "type": "unloadEquip",
                                "pos": 0
                            },
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
                                "name": "item:I893",
                                "value": "0"
                            },
                            {
                                "type": "setValue",
                                "name": "item:I894",
                                "value": "0"
                            },
                            {
                                "type": "setValue",
                                "name": "item:I895",
                                "value": "0"
                            },
                            {
                                "type": "setValue",
                                "name": "item:I897",
                                "value": "0"
                            },
                            {
                                "type": "changeFloor",
                                "floorId": "TS51",
                                "loc": [
                                    11,
                                    11
                                ],
                                "direction": "left"
                            }
                        ]
                    },
                    {
                        "text": "离去…",
                        "action": []
                    }
                ]
            }
        ]
    },
    "changeFloor": {
        "6,0": {
            "floorId": ":before",
            "stair": "upFloor"
        },
        "6,3": {
            "floorId": ":next",
            "stair": "downFloor"
        }
    },
    "beforeBattle": {},
    "afterBattle": {},
    "afterGetItem": {},
    "afterOpenDoor": {},
    "autoEvent": {},
    "cannotMove": {},
    "cannotMoveIn": {},
    "map": [
    [147,147,147,147,147,147, 88,147,147,147,147,147,147],
    [147,10179,147,10232,147,  0,  0,  0,147,10183,147,10179,147],
    [147,147,147,147,147,  0,891,  0,147,147,147,147,147],
    [147,147,147,147,147,  0, 87,  0,147,147,147,147,147],
    [147,147,  0,  0,  0,  0,  0,  0,  0,  0,  0,147,147],
    [147, 86,  0,147,  0,147,  0,147,  0,147,  0, 86,147],
    [147, 86,147,147, 86,147, 86,147, 86,147,147, 86,147],
    [147, 86,147,147, 86,147, 86,147, 86,147,147, 86,147],
    [147,  0,147,147, 86,147, 86,147, 86,147,147,  0,147],
    [147,990,147,991,  0,147,  0,147,  0,992,147,993,147],
    [147,147,147,147,147,147,994,147,147,147,147,147,147],
    [147,  0,147,  0,147,147,147,147,147,  0,147,  0,147],
    [147,147,147,147,147,147,  0,147,147,147,147,147,147]
],
    "bgmap": [

],
    "fgmap": [

],
    "bg2map": [
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,1486,  0,642,  0,  0,  0,  0,  0, 23,  0, 47,  0],
    [  0,  0,  0,  0,  0,  0,170409,  0,  0,  0,  0,  0,  0]
],
    "fg2map": [

]
}
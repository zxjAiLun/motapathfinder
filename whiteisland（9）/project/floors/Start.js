main.floors.Start=
{
    "floorId": "Start",
    "title": "O",
    "name": "O",
    "width": 13,
    "height": 13,
    "canFlyTo": true,
    "canFlyFrom": true,
    "canUseQuickShop": true,
    "cannotViewMap": false,
    "images": [],
    "ratio": 1,
    "defaultGround": 180019,
    "firstArrive": [
        {
            "type": "showStatusBar"
        },
        {
            "type": "setValue",
            "name": "flag:shop1",
            "value": "1"
        },
        {
            "type": "setText",
            "align": "left",
            "background": "winskin.png",
            "lineHeight": 22
        }
    ],
    "eachArrive": [],
    "parallelDo": "",
    "events": {
        "6,2": [
            {
                "type": "choices",
                "choices": [
                    {
                        "text": "游戏介绍",
                        "color": [
                            240,
                            233,
                            125,
                            1
                        ],
                        "action": [
                            "欢迎来到《白色孤岛》。\n这里有很多的小塔，希望你能够喜欢……\n在岛主的预想之中，\n你只需要在每个小塔停留短短几分钟的时间，\n就能顺利通过。",
                            "不过，\n你却无法像那些电影、动漫中的主角们一样，\n从小塔里得知什么秘密，获得什么宝物。\n因为，他们本身并没有什么特别的，\n只不过是能在几分钟之内，就通过的小塔罢了。",
                            "它们若能填补你闲暇时碎片化的几分钟，\n那么它们的使命就完成了。\n当然，如果你想的话，\n可以选择把这些塔的所有路线全部拆解，\n那样——可能会多用一些时间吧！"
                        ]
                    },
                    {
                        "text": "回放录像",
                        "color": [
                            211,
                            103,
                            139,
                            1
                        ],
                        "action": [
                            {
                                "type": "function",
                                "function": "function(){\ncore.control.checkBgm()\n}"
                            },
                            {
                                "type": "if",
                                "condition": "(!core.isReplaying())",
                                "true": [
                                    {
                                        "type": "function",
                                        "function": "function(){\ncore.chooseReplayFile()\n}"
                                    }
                                ],
                                "false": []
                            }
                        ]
                    },
                    {
                        "text": "退出选择",
                        "action": []
                    }
                ]
            }
        ],
        "6,10": [
            {
                "type": "choices",
                "text": "\t[千夜,E716]如果你喜欢本作，\n可以关注我的B站账号：\r[yellow]幼年猫妖\r，以第一时间获取更新信息。\n也可以加入讨论群\r[yellow]947190984\r，与作者和其他玩家交流讨论。\n每一份这样的支持都可以为作者提供更多的精神动力。",
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
                                "text": "\t[千夜,E716]B站账号：\r[yellow]幼年猫妖\r\n讨论群：\r[yellow]947190984\r",
                                "choices": [
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
                                        "text": "纸船效应",
                                        "action": [
                                            {
                                                "type": "function",
                                                "function": "function(){\nwindow.open(\"https://h5mota.com/games/Boat/\")\n}"
                                            }
                                        ]
                                    },
                                    {
                                        "text": "下一页",
                                        "action": [
                                            {
                                                "type": "choices",
                                                "text": "\t[千夜,E716]B站账号：\r[yellow]幼年猫妖\r\n讨论群：\r[yellow]947190984\r",
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
                                                        "text": "返回上一页",
                                                        "action": [
                                                            {
                                                                "type": "insert",
                                                                "loc": [
                                                                    6,
                                                                    10
                                                                ]
                                                            }
                                                        ]
                                                    },
                                                    {
                                                        "text": "退出选项",
                                                        "action": []
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
                        "text": "退出选项",
                        "action": []
                    }
                ]
            }
        ],
        "3,3": [
            {
                "type": "choices",
                "text": "第一阶梯。\n你将以\r[gold]100/1/1\r开局。",
                "choices": [
                    {
                        "text": "试炼间",
                        "color": [
                            130,
                            234,
                            171,
                            1
                        ],
                        "action": [
                            {
                                "type": "function",
                                "function": "function(){\ncore.setFlag(\"__visited__\", {});\n}"
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
                        "text": "魔法屋",
                        "color": [
                            154,
                            209,
                            222,
                            1
                        ],
                        "action": [
                            {
                                "type": "function",
                                "function": "function(){\ncore.setFlag(\"__visited__\", {});\n}"
                            },
                            {
                                "type": "changeFloor",
                                "floorId": "B1",
                                "loc": [
                                    1,
                                    9
                                ],
                                "direction": "down"
                            }
                        ]
                    },
                    {
                        "text": "白骨岭",
                        "color": [
                            143,
                            137,
                            160,
                            1
                        ],
                        "action": [
                            {
                                "type": "function",
                                "function": "function(){\ncore.setFlag(\"__visited__\", {});\n}"
                            },
                            {
                                "type": "changeFloor",
                                "floorId": "C1",
                                "loc": [
                                    6,
                                    1
                                ],
                                "direction": "down"
                            }
                        ]
                    },
                    {
                        "text": "兽巢",
                        "color": [
                            210,
                            193,
                            106,
                            1
                        ],
                        "action": [
                            {
                                "type": "function",
                                "function": "function(){\ncore.setFlag(\"__visited__\", {});\n}"
                            },
                            {
                                "type": "changeFloor",
                                "floorId": "D1",
                                "loc": [
                                    11,
                                    1
                                ],
                                "direction": "down"
                            }
                        ]
                    },
                    {
                        "text": "傀儡庭院",
                        "color": [
                            200,
                            133,
                            244,
                            1
                        ],
                        "action": [
                            {
                                "type": "function",
                                "function": "function(){\ncore.setFlag(\"__visited__\", {});\n}"
                            },
                            {
                                "type": "changeFloor",
                                "floorId": "F1",
                                "loc": [
                                    11,
                                    11
                                ],
                                "direction": "left"
                            }
                        ]
                    },
                    {
                        "text": "逃生舱",
                        "color": [
                            244,
                            133,
                            157,
                            1
                        ],
                        "action": [
                            {
                                "type": "function",
                                "function": "function(){\ncore.setFlag(\"__visited__\", {});\n}"
                            },
                            {
                                "type": "changeFloor",
                                "floorId": "G1",
                                "loc": [
                                    1,
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
        "9,3": [
            {
                "type": "choices",
                "text": "第二阶梯。\n你将以\r[gold]300/3/3\r开局。",
                "choices": [
                    {
                        "text": "小巷道",
                        "color": [
                            203,
                            212,
                            204,
                            1
                        ],
                        "action": [
                            {
                                "type": "setValue",
                                "name": "status:hp",
                                "value": "300"
                            },
                            {
                                "type": "setValue",
                                "name": "status:atk",
                                "value": "3"
                            },
                            {
                                "type": "setValue",
                                "name": "status:def",
                                "value": "3"
                            },
                            {
                                "type": "function",
                                "function": "function(){\ncore.setFlag(\"__visited__\", {});\n}"
                            },
                            {
                                "type": "changeFloor",
                                "floorId": "A21",
                                "loc": [
                                    11,
                                    1
                                ],
                                "direction": "down"
                            }
                        ]
                    },
                    {
                        "text": "含盐地",
                        "color": [
                            240,
                            238,
                            184,
                            1
                        ],
                        "action": [
                            {
                                "type": "setValue",
                                "name": "status:hp",
                                "value": "300"
                            },
                            {
                                "type": "setValue",
                                "name": "status:atk",
                                "value": "3"
                            },
                            {
                                "type": "setValue",
                                "name": "status:def",
                                "value": "3"
                            },
                            {
                                "type": "function",
                                "function": "function(){\ncore.setFlag(\"__visited__\", {});\n}"
                            },
                            {
                                "type": "changeFloor",
                                "floorId": "B21",
                                "loc": [
                                    2,
                                    11
                                ],
                                "direction": "right"
                            }
                        ]
                    },
                    {
                        "text": "死火山",
                        "color": [
                            222,
                            96,
                            147,
                            1
                        ],
                        "action": [
                            {
                                "type": "setValue",
                                "name": "status:hp",
                                "value": "300"
                            },
                            {
                                "type": "setValue",
                                "name": "status:atk",
                                "value": "3"
                            },
                            {
                                "type": "setValue",
                                "name": "status:def",
                                "value": "3"
                            },
                            {
                                "type": "function",
                                "function": "function(){\ncore.setFlag(\"__visited__\", {});\n}"
                            },
                            {
                                "type": "changeFloor",
                                "floorId": "C21",
                                "loc": [
                                    1,
                                    9
                                ],
                                "direction": "down"
                            }
                        ]
                    },
                    {
                        "text": "薄冰岛",
                        "color": [
                            96,
                            204,
                            222,
                            1
                        ],
                        "action": [
                            {
                                "type": "setValue",
                                "name": "status:hp",
                                "value": "300"
                            },
                            {
                                "type": "setValue",
                                "name": "status:atk",
                                "value": "3"
                            },
                            {
                                "type": "setValue",
                                "name": "status:def",
                                "value": "3"
                            },
                            {
                                "type": "function",
                                "function": "function(){\ncore.setFlag(\"__visited__\", {});\n}"
                            }
                        ]
                    },
                    {
                        "text": "蘑菇路",
                        "color": [
                            215,
                            129,
                            241,
                            1
                        ],
                        "action": [
                            {
                                "type": "setValue",
                                "name": "status:hp",
                                "value": "300"
                            },
                            {
                                "type": "setValue",
                                "name": "status:atk",
                                "value": "3"
                            },
                            {
                                "type": "setValue",
                                "name": "status:def",
                                "value": "3"
                            },
                            {
                                "type": "function",
                                "function": "function(){\ncore.setFlag(\"__visited__\", {});\n}"
                            }
                        ]
                    },
                    {
                        "text": "井梯",
                        "color": [
                            222,
                            177,
                            114,
                            1
                        ],
                        "action": [
                            {
                                "type": "setValue",
                                "name": "status:hp",
                                "value": "300"
                            },
                            {
                                "type": "setValue",
                                "name": "status:atk",
                                "value": "3"
                            },
                            {
                                "type": "setValue",
                                "name": "status:def",
                                "value": "3"
                            },
                            {
                                "type": "function",
                                "function": "function(){\ncore.setFlag(\"__visited__\", {});\n}"
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
    "changeFloor": {},
    "beforeBattle": {},
    "afterBattle": {},
    "afterGetItem": {},
    "afterOpenDoor": {},
    "autoEvent": {},
    "cannotMove": {},
    "cannotMoveIn": {},
    "map": [
    [ 20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20],
    [ 20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20],
    [ 20, 20, 20, 20, 20, 20,102, 20, 20, 20, 20, 20, 20],
    [ 20, 20, 20,102,  0,  0,  0,  0,  0,102, 20, 20, 20],
    [ 20, 20,  0,  0,  0,  0,  0,  0,  0,  0,  0, 20, 20],
    [ 20, 20,  0,  0,  0,  0,  0,  0,  0,  0,  0, 20, 20],
    [ 20,102,  0,  0,600,  0,  0,  0, 45,  0,  0,102, 20],
    [ 20, 20,  0,  0,  0,  0,  0,  0,  0,  0,  0, 20, 20],
    [ 20, 20, 20,  0,  0,  0, 46,  0,  0,  0, 20, 20, 20],
    [ 20, 20, 20,102,  0,  0,  0,  0,  0,102, 20, 20, 20],
    [ 20, 20, 20, 20, 20, 20,891, 20, 20, 20, 20, 20, 20],
    [ 20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20],
    [ 20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20]
],
    "bgmap": [

],
    "fgmap": [
    [153,153,153,  0,  0,153,153,153,  0,  0,153,153,153],
    [153,153,  0,  0,  0,  0,101,  0,  0,  0,  0,153,153],
    [153,  0,  0,101,  0,  0,  0,  0,  0,101,  0,  0,153],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,101,  0,  0,  0,  0,  0,  0,  0,  0,  0,101,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,101,  0,  0,  0,  0,  0,101,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [153,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,153],
    [153,153,  0,  0,  0,  0,  0,  0,  0,  0,  0,153,153],
    [153,153,153,  0,  0,153,153,153,  0,  0,153,153,153]
],
    "bg2map": [
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,10185,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,10186,  0,  0,  0,  0,  0,10187,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,10188,  0,  0,  0,  0,  0,  0,  0,10189,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,10193,  0,  0,  0,10194,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0]
],
    "fg2map": [

],
    "bgm": null
}
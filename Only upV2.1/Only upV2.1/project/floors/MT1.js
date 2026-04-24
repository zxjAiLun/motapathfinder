main.floors.MT1=
{
    "floorId": "MT1",
    "title": "萤火幽墟 - 1",
    "name": "萤火幽墟 - 1",
    "width": 13,
    "height": 13,
    "canFlyTo": true,
    "canFlyFrom": true,
    "canUseQuickShop": true,
    "cannotViewMap": false,
    "images": [
        {
            "name": "1.jpg",
            "canvas": "bg",
            "x": 0,
            "y": 0
        }
    ],
    "ratio": 1,
    "defaultGround": 300,
    "bgm": "1.mp3",
    "firstArrive": [
        {
            "type": "showStatusBar"
        },
        {
            "type": "setValue",
            "name": "item:book",
            "value": "1"
        },
        {
            "type": "setValue",
            "name": "item:fly",
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
        "6,5": {
            "trigger": "action",
            "enable": true,
            "noPass": null,
            "displayDamage": true,
            "opacity": 1,
            "filter": {
                "blur": 0,
                "hue": 0,
                "grayscale": 0,
                "invert": false,
                "shadow": 0
            },
            "data": [
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
                                                                        4,
                                                                        9
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
            ]
        },
        "6,9": [
            {
                "type": "choices",
                "text": "\t[仙子,fairy]嗨，你来啦。\n你是无限维度至高意志为了对抗无上恐怖存在，\n而自然衍生出的\r[black]Absolute Infinite\r一遇的，\n超越\r[red]「变数」\r级，\r[gray]冠绝无穷维度\r的天骄少女\r[#66CCFF]纱雪\r。\n由于上面那只猫选择了你作为主角，\n导致这个塔非常好玩，\n每个宝石都可以秒杀怪物！\n每5层的Boss处都可以得到数目为：\n\r[yellow]当前生命/当区宝石血瓶系数\r的血点！\n因为害怕怪物被秒得太快就用血点计分了。",
                "choices": [
                    {
                        "text": "降低难度",
                        "color": [
                            103,
                            193,
                            211,
                            1
                        ],
                        "action": [
                            {
                                "type": "if",
                                "condition": "(flag:level0==1)",
                                "true": [
                                    "已经是最低难度了！"
                                ],
                                "false": [
                                    {
                                        "type": "if",
                                        "condition": "(item:I582==1)",
                                        "true": [
                                            "难度：\r[red]\\dHard 6\r → \r[#66CCFF]Easy 3\r。",
                                            {
                                                "type": "setValue",
                                                "name": "item:I582",
                                                "value": "0"
                                            },
                                            {
                                                "type": "setValue",
                                                "name": "item:I581",
                                                "value": "1"
                                            },
                                            {
                                                "type": "setValue",
                                                "name": "flag:level0",
                                                "value": "1"
                                            }
                                        ],
                                        "false": [
                                            "难度：\r[#9932CC]\\dChaos 10\r → \r[red]Hard 6\r。",
                                            {
                                                "type": "setValue",
                                                "name": "item:I582",
                                                "value": "1"
                                            }
                                        ]
                                    }
                                ]
                            }
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
                        "_collapsed": true,
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
        ]
    },
    "changeFloor": {
        "6,0": {
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
    [283,400208,400209,283,283,283, 87,283,283,283,400208,400209,283],
    [283,  0,210,  0,209,576,  0,577,209,  0,207,  0,283],
    [283,584,283,578,400376,400377,400377,400377,400378, 30,283,579,283],
    [283,283, 28,  0,208,576,400361, 33,211,  0, 34,283,283],
    [400186,283,283,204,283,283,283,283,283,204,283,283,400186],
    [283, 58,211,  0,283,283,716,283,283,  0,201, 27,283],
    [283,400179,283,203,283,600,  0, 29,283,202,283,400179,283],
    [400167,283, 31,  0,201,  0,  0,  0,203,  0,586,283,400166],
    [400175,283,202,283,283, 31,  0, 27,283,283,202,283,400174],
    [283,283,  0, 27,283,283,124,283,283, 28,  0,283,283],
    [283,400173,283,203,283,283,283,283,283,203,283,400173,283],
    [577,208,578,  0,205, 28,  0, 32,205,  0, 34,206,576],
    [283,283,400344,400344,283,283,400345,283,283,400344,400344,283,283]
],
    "bgmap": [

],
    "fgmap": [
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,400368,400369,400369,400369,400370,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,400353,  0,  0,  0,  0,  0,  0],
    [400178,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,400178],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0]
],
    "bg2map": [

],
    "fg2map": [

]
}
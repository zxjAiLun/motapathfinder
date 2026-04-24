main.floors.MT70=
{
    "floorId": "MT70",
    "title": "70 层",
    "name": "70 层",
    "width": 13,
    "height": 13,
    "canFlyTo": true,
    "canFlyFrom": true,
    "canUseQuickShop": true,
    "cannotViewMap": false,
    "images": [],
    "ratio": 20,
    "defaultGround": 150654,
    "bgm": "5.mp3",
    "firstArrive": [
        "\t[纳可]那，那是——！",
        {
            "type": "function",
            "function": "function(){\ncore.drawWarning(6, 1, '地宫养殖者')\n}"
        },
        {
            "type": "sleep",
            "time": 3000,
            "noSkip": true
        },
        "\t[纳娜米]看来我们找对地方了呢。\n这些狂躁荒兽的源头，就在这里吧。",
        "\t[纳娜米]还有可怕强者的气息。\n可可，待会我们可能需要面对无法战胜的对手。\n在我拿出底牌之前，一定不要轻举妄动。",
        "\t[纳可]……我知道了。"
    ],
    "eachArrive": [],
    "parallelDo": "",
    "events": {
        "6,1": {
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
                    "type": "if",
                    "condition": "(flag:newitem==1)",
                    "true": [],
                    "false": [
                        "\t[地宫养殖者]哦……有人闯到这里来了？",
                        "\t[纳娜米]我不会和你废话。\n说，你为什么要害我纳家！",
                        "\t[地宫养殖者]呵呵，一个刚刚踏入大地级的小丫头，\n竟敢用这种口气和我说话，勇气可嘉。",
                        "\t[纳可]姐姐，这家伙长得好可怕。\n身上好像发了霉一样。",
                        "\t[地宫养殖者]现在的小朋友可真是没礼貌，没大没小。\n不过也无所谓，毕竟你还有利用价值。",
                        "\t[地宫养殖者]不像那些连一点杀气都承受不了的废物，\n连骨头渣都剩不下。",
                        "\t[纳娜米]你这家伙……！\n这处所谓的地宫，藏宝地，究竟是怎么回事？",
                        "\t[地宫养殖者]哦……死到临头，还在好奇这个？\n既然如此，那我就告诉你吧。",
                        "\t[地宫养殖者]从十五年前说起，在那时候，\n燕岗领存在一个组织，\n名为‘血杀殿’。",
                        "\t[纳娜米]什么？\n血杀殿，不是已经破灭了吗？",
                        "\t[纳可]姐姐，血杀殿是什么？",
                        "\t[纳娜米]我也只是道听途说。\n那是十五年前存在于燕岗领的，\n一个见不得光的黑暗势力。",
                        "\t[纳娜米]他们的噬血之术，\n能够吸收大量强者的血液，\n来提升自己的血脉之力。",
                        "\t[地宫养殖者]哈哈哈，小丫头懂得倒是不少。\n当年的血杀殿，由于修炼禁忌的噬血之术，\n而被燕岗城主率众剿灭。",
                        "\t[地宫养殖者]真狠啊——\n整个血杀殿上上下下，被灭得一干二净，\n只有外出执行任务的我，逃过一劫。",
                        "\t[纳可]唔……",
                        "\t[纳娜米]……你们利用噬血之术，\n吞噬那么多强者的血肉时，\n难道没想过自己做得有多狠吗？",
                        "\t[地宫养殖者]说得好，哈哈哈。\n在血洛大陆，这种事都是家常便饭罢了。",
                        "\t[地宫养殖者]我们没有强大的修炼天赋，\n只能靠邪魔歪道，利用噬血之术，\n养殖着一群意识被杀气泯灭，只剩行尸走肉的强者。",
                        "\t[地宫养殖者]他们将源源不断提供进化的养料，\n就如现在一般——在血杀殿灭门时，我只是大地级。\n而现在，我已经是天空级！",
                        "\t[地宫养殖者]可这还不够，我需要更多的力量。\n地宫的消息，也是我故意让你们家族散布出去的。",
                        "\t[地宫养殖者]在你们的强者赶到之前，\n我要让你们燕岗领元气大伤，\n血债血偿！",
                        "\t[纳娜米]原来如此。\n如果没有猜错的话，\n那个深不见底的深坑，就是你的“逃跑路线”吧？",
                        "\t[地宫养殖者]哈哈哈，你这丫头可真是有意思，\n居然问这种幼稚的问题。",
                        "\t[纳娜米]既然如此，时间也差不多了……\n可可！",
                        "少女手上突然出现了一把奇异的武器。\n武器一米见长，前端有着深黑色的空洞。\n通体的质感，带来的威慑力令人窒息。",
                        "几乎零点一秒之内，纳娜米手中的武器，\n绽放出耀眼的银白色光芒。\n只听轰隆一声巨响，整座地宫都似乎为之震颤！",
                        {
                            "type": "animate",
                            "name": "light2",
                            "loc": [
                                6,
                                1
                            ]
                        },
                        {
                            "type": "vibrate",
                            "direction": "horizontal",
                            "time": 1500,
                            "speed": 66,
                            "power": 66
                        },
                        {
                            "type": "animate",
                            "name": "light2",
                            "loc": [
                                6,
                                1
                            ]
                        },
                        "遭到反震力冲击的纳娜米吐出鲜血。\n反应过来的纳可，第一时间抱住了姐姐，\n一同抵挡着这武器带来的惊人的后坐力。",
                        "\t[纳可]没事吧，姐姐——",
                        "\t[纳娜米]咳……还没有结束，可可。\n接下来，就交给你了！",
                        "正面被武器击中的地宫养殖者，\n几乎瞬间失去了半边身体，\n发出了怨毒的咆哮声。",
                        "\t[地宫养殖者]啊，什么东西，不可能！！\n该死，中计了，我要杀了你，杀了你们，\n杀光你们燕岗领的人——",
                        "\t[纳娜米]可可，不要大意！\n这是天空级强者的回光返照，\n只要撑过这一会就足够了！",
                        "\t[纳可]……明白！",
                        "地宫养殖者已经奄奄一息！\n属性削弱为之前的百分之一！",
                        {
                            "type": "setBlock",
                            "number": "E356",
                            "loc": [
                                [
                                    6,
                                    1
                                ]
                            ]
                        },
                        {
                            "type": "callBook"
                        },
                        {
                            "type": "battle",
                            "id": "E356"
                        },
                        {
                            "type": "setCurtain",
                            "color": [
                                255,
                                255,
                                255,
                                1
                            ],
                            "time": 1000,
                            "keep": true
                        },
                        {
                            "type": "choices",
                            "text": "【第一幕】已结束。可以登录后在这里提交成绩，\n防止存档丢失。你可以选择以下三种计分方式。\n\n在【天之门】中，一把绿钥匙计为100兆分数，\n因此成绩的排头数字将代表你的绿钥匙数量。\n你保留下的绿钥匙越多，对于分数就越有利。\n\n【生之门】将记录为你当前生命。\n\n【匙之门】则只看持有的道具数量。\n权值为：黄钥匙1、蓝钥匙3、\n红钥匙/破墙镐/飞行器10、绿钥匙25。",
                            "choices": [
                                {
                                    "text": "天之门",
                                    "color": [
                                        111,
                                        229,
                                        139,
                                        1
                                    ],
                                    "action": [
                                        {
                                            "type": "setValue",
                                            "name": "status:hp",
                                            "operator": "+=",
                                            "value": "item:greenKey*1e14"
                                        },
                                        {
                                            "type": "win",
                                            "reason": "第一幕 - 天之门",
                                            "noexit": 1
                                        },
                                        {
                                            "type": "insert",
                                            "loc": [
                                                6,
                                                3
                                            ],
                                            "floorId": "sample0"
                                        }
                                    ]
                                },
                                {
                                    "text": "生之门",
                                    "color": [
                                        231,
                                        110,
                                        190,
                                        1
                                    ],
                                    "action": [
                                        {
                                            "type": "win",
                                            "reason": "第一幕 - 生之门",
                                            "noexit": 1
                                        },
                                        {
                                            "type": "insert",
                                            "loc": [
                                                6,
                                                3
                                            ],
                                            "floorId": "sample0"
                                        }
                                    ]
                                },
                                {
                                    "text": "匙之门",
                                    "color": [
                                        227,
                                        206,
                                        93,
                                        1
                                    ],
                                    "action": [
                                        {
                                            "type": "if",
                                            "condition": "(item:yellowKey+item:blueKey*3+item:redKey*10+item:pickaxe*10+item:centerFly*10+item:greenKey*25==(0==1))",
                                            "true": [
                                                {
                                                    "type": "setValue",
                                                    "name": "status:hp",
                                                    "operator": "/=",
                                                    "value": "生命*2"
                                                }
                                            ],
                                            "false": [
                                                {
                                                    "type": "setValue",
                                                    "name": "status:hp",
                                                    "value": "item:yellowKey+item:blueKey*3+item:redKey*10+item:pickaxe*10+item:centerFly*10+item:greenKey*25"
                                                }
                                            ]
                                        },
                                        {
                                            "type": "win",
                                            "reason": "第一幕 - 匙之门",
                                            "noexit": 1
                                        },
                                        {
                                            "type": "insert",
                                            "loc": [
                                                6,
                                                3
                                            ],
                                            "floorId": "sample0"
                                        }
                                    ]
                                },
                                {
                                    "text": "继续游戏",
                                    "color": [
                                        159,
                                        214,
                                        220,
                                        1
                                    ],
                                    "action": [
                                        {
                                            "type": "if",
                                            "condition": "(item:I821==0)",
                                            "true": [
                                                "\r[gold]高能反应！\n检测到纳娜米未在队伍中！\r",
                                                "理论上……这并不是不可能的事情，\n但你到底是怎么做到以一己之力，\n杀穿地宫，甚至击败了养殖者的？！",
                                                "什么概念！按道理这里应该奖励幸运数字的！\n可由于你达成的操作，难度实在太高，\n为了照顾幸运数字的收集玩家，不能放在这里！",
                                                "那么，你喜欢\r[#75E97E]绿钥匙\r吗？\n就送你两串绿钥匙，\n当作给挑战者的奖励好了！",
                                                {
                                                    "type": "setValue",
                                                    "name": "item:I902",
                                                    "operator": "+=",
                                                    "value": "2"
                                                },
                                                "\r[#75E97E]获得了2个绿钥匙串，\n绿钥匙+8！\r"
                                            ],
                                            "false": []
                                        },
                                        {
                                            "type": "setValue",
                                            "name": "item:I952",
                                            "value": "1"
                                        },
                                        {
                                            "type": "hide",
                                            "loc": [
                                                [
                                                    6,
                                                    1
                                                ]
                                            ],
                                            "remove": true
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
                                            "type": "unfollow",
                                            "name": "nanami.png"
                                        },
                                        {
                                            "type": "setValue",
                                            "name": "item:I821",
                                            "value": "0"
                                        },
                                        {
                                            "type": "setCurtain",
                                            "time": 1000,
                                            "moveMode": "easeIn"
                                        }
                                    ]
                                }
                            ]
                        }
                    ]
                }
            ]
        }
    },
    "changeFloor": {
        "7,7": {
            "floorId": ":before",
            "stair": "upFloor"
        }
    },
    "beforeBattle": {},
    "afterBattle": {
        "10,9": [
            {
                "type": "setValue",
                "name": "flag:door_MT70_9_10",
                "operator": "+=",
                "value": "1"
            }
        ],
        "10,11": [
            {
                "type": "setValue",
                "name": "flag:door_MT70_9_10",
                "operator": "+=",
                "value": "1"
            }
        ],
        "7,9": [
            {
                "type": "setValue",
                "name": "flag:door_MT70_6_10",
                "operator": "+=",
                "value": "1"
            }
        ],
        "7,11": [
            {
                "type": "setValue",
                "name": "flag:door_MT70_6_10",
                "operator": "+=",
                "value": "1"
            }
        ],
        "4,9": [
            {
                "type": "setValue",
                "name": "flag:door_MT70_2_6",
                "operator": "+=",
                "value": "1"
            }
        ],
        "4,11": [
            {
                "type": "setValue",
                "name": "flag:door_MT70_2_6",
                "operator": "+=",
                "value": "1"
            }
        ],
        "1,7": [
            {
                "type": "setValue",
                "name": "flag:door_MT70_3_10",
                "operator": "+=",
                "value": "1"
            }
        ],
        "3,7": [
            {
                "type": "setValue",
                "name": "flag:door_MT70_3_10",
                "operator": "+=",
                "value": "1"
            }
        ],
        "1,3": [
            {
                "type": "setValue",
                "name": "flag:door_MT70_6_2",
                "operator": "+=",
                "value": "1"
            }
        ],
        "2,4": [
            {
                "type": "setValue",
                "name": "flag:door_MT70_6_2",
                "operator": "+=",
                "value": "1"
            }
        ],
        "4,3": [
            {
                "type": "setValue",
                "name": "flag:door_MT70_6_2",
                "operator": "+=",
                "value": "1"
            }
        ],
        "8,3": [
            {
                "type": "setValue",
                "name": "flag:door_MT70_6_2",
                "operator": "+=",
                "value": "1"
            }
        ],
        "10,4": [
            {
                "type": "setValue",
                "name": "flag:door_MT70_6_2",
                "operator": "+=",
                "value": "1"
            }
        ],
        "11,3": [
            {
                "type": "setValue",
                "name": "flag:door_MT70_6_2",
                "operator": "+=",
                "value": "1"
            }
        ]
    },
    "afterGetItem": {},
    "afterOpenDoor": {},
    "autoEvent": {
        "9,10": {
            "0": {
                "condition": "flag:door_MT70_9_10==2",
                "currentFloor": true,
                "priority": 0,
                "delayExecute": false,
                "multiExecute": false,
                "data": [
                    {
                        "type": "openDoor"
                    },
                    {
                        "type": "setValue",
                        "name": "flag:door_MT70_9_10",
                        "operator": "=",
                        "value": "null"
                    }
                ]
            }
        },
        "6,10": {
            "0": {
                "condition": "flag:door_MT70_6_10==2",
                "currentFloor": true,
                "priority": 0,
                "delayExecute": false,
                "multiExecute": false,
                "data": [
                    {
                        "type": "openDoor"
                    },
                    {
                        "type": "setValue",
                        "name": "flag:door_MT70_6_10",
                        "operator": "=",
                        "value": "null"
                    }
                ]
            }
        },
        "3,10": {
            "0": {
                "condition": "flag:door_MT70_2_6==2",
                "currentFloor": true,
                "priority": 0,
                "delayExecute": false,
                "multiExecute": false,
                "data": [
                    {
                        "type": "openDoor"
                    },
                    {
                        "type": "setValue",
                        "name": "flag:door_MT70_2_6",
                        "value": "null"
                    }
                ]
            },
            "1": null
        },
        "2,6": {
            "0": {
                "condition": "flag:door_MT70_3_10==2",
                "currentFloor": true,
                "priority": 0,
                "delayExecute": false,
                "multiExecute": false,
                "data": [
                    {
                        "type": "openDoor"
                    },
                    {
                        "type": "setValue",
                        "name": "flag:door_MT70_3_10",
                        "operator": "=",
                        "value": "null"
                    }
                ]
            },
            "1": null
        },
        "6,2": {
            "0": {
                "condition": "flag:door_MT70_6_2==6",
                "currentFloor": true,
                "priority": 0,
                "delayExecute": false,
                "multiExecute": false,
                "data": [
                    {
                        "type": "openDoor"
                    },
                    {
                        "type": "setValue",
                        "name": "flag:door_MT70_6_2",
                        "value": "null"
                    }
                ]
            },
            "1": null
        }
    },
    "cannotMove": {},
    "cannotMoveIn": {},
    "map": [
    [150111,150111,150111,150111,150111,150074,151340,150072,150111,150111,150111,150111,150111],
    [150119,150119,150119,150119,150119,150082,355,150080,150119,150119,150119,150119,150119],
    [150127,150127,150127,150127,150127,150090, 85,150088,150127,150127,150127,150127,150127],
    [144,352,  0,  0,353,  0,  0,  0,353,  0,  0,352,144],
    [144,144,351,  0,  0,  0,  0,  0,  0,  0,351,144,144],
    [144,144,  0,  0,  0,  0,  0,  0,  0,  0,  0,144,144],
    [144,144, 85,144,144,144,144,144,144,144,144,144,144],
    [144,353,  0,353,144,150387,144, 88,  0,585,  0, 60,144],
    [144,144,638,144,144,144,144,144,144,144,144, 86,144],
    [144,144,  0,144,354,144,144,352,144,144,351,  0,144],
    [144,144,636, 85,  0,635, 85,  0,641, 85,  0,584,144],
    [144,144,144,144,354,144,144,352,144,144,351,144,144],
    [144,144,144,144,144,144,144,144,144,144,144,144,144]
],
    "bgmap": [

],
    "fgmap": [
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,150371,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,150379,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0]
],
    "bg2map": [
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,151316,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,151316,  0,  0,  0,  0,  0,  0],
    [  0,151316,151316,151316,151316,151316,151316,151316,151316,151316,151316,151316,  0],
    [  0,  0,151316,151316,151316,151316,151316,151316,151316,151316,151316,  0,  0],
    [  0,  0,151316,151316,151316,151316,151316,151316,151316,151316,151316,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0]
],
    "fg2map": [

]
}
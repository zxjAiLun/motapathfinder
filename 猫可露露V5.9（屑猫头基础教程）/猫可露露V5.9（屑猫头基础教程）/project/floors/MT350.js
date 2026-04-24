main.floors.MT350=
{
    "floorId": "MT350",
    "title": "350 层",
    "name": "350 层",
    "width": 13,
    "height": 13,
    "canFlyTo": true,
    "canFlyFrom": true,
    "canUseQuickShop": true,
    "cannotViewMap": false,
    "images": [
        {
            "name": "03.png",
            "canvas": "bg",
            "x": 0,
            "y": 0
        }
    ],
    "ratio": 2000000,
    "defaultGround": 906,
    "bgm": "20.mp3",
    "firstArrive": [
        {
            "type": "setCurtain",
            "color": [
                0,
                0,
                0,
                1
            ],
            "time": 0,
            "keep": true
        },
        {
            "type": "setCurtain",
            "time": 2000
        },
        "\t[纳可]终于到了，\n支撑整片幻境的力量源泉……\n就在这里吗？",
        {
            "type": "setBlock",
            "number": "bearLeft",
            "loc": [
                [
                    6,
                    6
                ]
            ]
        },
        "\t[左阿]恭喜你，小丫头。\n活着走到这里，\n代表你有资格获得我【左阿】的传承。",
        "\t[左阿]只不过——",
        "\t[纳可]不用你揭开谜底，我已经知道了。\n你编造了很多谎言，\n真是让人失望，左阿前辈。",
        {
            "type": "function",
            "function": "function(){\ncore.drawWarning(6, 6, ' 左 阿 ')\n}"
        },
        {
            "type": "sleep",
            "time": 3000
        },
        "\t[左阿]啊哈哈哈哈哈，很好，有趣有趣。\n看来事情，稍微有了那么一点点，\n出乎意料的变化。",
        "\t[纳可]你的时代已经过去了，前辈，\n没有必要再在这里兴风作浪了。",
        "\t[左阿]别废话了，如今我十万年的大计，\n只差最后一步，\n又岂会因为一个小丫头而放弃。",
        "\t[左阿]你知道我有多恨那个老不死的门主吧。\n如果不是因为他，\n我这等枭雄又岂会屈居这结界内十万年。",
        "\t[纳可]做了这么多的事情，\n你还没有意识到自己的不择手段吗？\n你的路从最开始，就已经走错了。",
        "\t[左阿]哈哈哈，可笑。凭你身上的精神印记判断，\n你背后的人，起码是领域级高阶！",
        "\t[左阿]我可没有你们大家族子弟这么好的运气，\n一路走来，靠的都是我自己的能力。",
        "\t[左阿]我的父母本为混元门的杂役弟子，\n在外执行任务的途中，不幸去世，\n留下我孤身一人。",
        "\t[左阿]宗门碍于情面，不想被其他门派说道，\n才接纳了我这个资质平平的小鬼。\n否则你以为我，有什么资格被大宗门所接受？",
        "\t[左阿]这只是我的起步，可我付出的，\n已经远比你这种人要多得多！",
        "\t[纳可]也许你的路走得很艰辛……\n可我并不想与你谈论这些，\n我只想击败你，打破这个结界的囚笼。",
        "\t[纳可]十万年间，总共有二十三万余冒险者，\n闯入了这里。他们中未到天空级的二十万，\n在踏入的一瞬间便化为了结界的养分。",
        "\t[纳可]三万天空级，在水牢的时间加速下，\n历经五十万年，无数场屠杀，\n仅剩如今的几百人存活。",
        "\t[纳可]另外，还有二十五位云霄级强者，\n由于已经足够作为容器，\n因此被你毫不留情地直接杀死……",
        "\t[左阿]小丫头，不知道你从哪里，\n听来了所谓的真相。\n可你在我面前说这些，还是太嫩了。",
        "\t[纳可]……放了水牢里的所有人，解除这片结界。\n左阿前辈，看在你对我的“栽培”上，\n这是我最后一次劝你……！",
        "\t[左阿]开什么玩笑？你这点儿修为，\n连我一缕精神力量都根本奈何不得，\n还敢跟我谈条件——",
        {
            "type": "sleep",
            "time": 1000,
            "noSkip": true
        },
        "\t[纳可]是吗？那……可不一定。\n\n是时候蜕变了，领域力量。",
        {
            "type": "setValue",
            "name": "item:I933",
            "value": "1"
        },
        {
            "type": "loadEquip",
            "id": "I933"
        },
        "领悟了第四重领域【出云落月】！\n将为你自动装备，可在装备栏查看详情。",
        "\t[纳可]（到得现在，在直面领域级强者，\n感受其来自领域的威压之后，\n本就临近突破的四重领域，终于迈出了最后一步。）",
        "\t[左阿]哈哈哈，你的底牌只是如此吗，\n那就不要怪我——",
        "\t[纳可]离结束还早呢……",
        {
            "type": "animate",
            "name": "huifu",
            "loc": [
                6,
                6
            ]
        },
        {
            "type": "setBlock",
            "number": "evilBat",
            "loc": [
                [
                    5,
                    2
                ]
            ]
        },
        {
            "type": "setBlock",
            "number": "evilBat",
            "loc": [
                [
                    7,
                    2
                ]
            ]
        },
        {
            "type": "setBlock",
            "number": "evilBat",
            "loc": [
                [
                    5,
                    4
                ]
            ]
        },
        {
            "type": "setBlock",
            "number": "evilBat",
            "loc": [
                [
                    7,
                    4
                ]
            ]
        },
        {
            "type": "setBlock",
            "number": "evilBat",
            "loc": [
                [
                    2,
                    5
                ]
            ]
        },
        {
            "type": "setBlock",
            "number": "evilBat",
            "loc": [
                [
                    10,
                    5
                ]
            ]
        },
        {
            "type": "setBlock",
            "number": "evilBat",
            "loc": [
                [
                    2,
                    7
                ]
            ]
        },
        {
            "type": "setBlock",
            "number": "evilBat",
            "loc": [
                [
                    10,
                    7
                ]
            ]
        },
        {
            "type": "setBlock",
            "number": "evilBat",
            "loc": [
                [
                    5,
                    8
                ]
            ]
        },
        {
            "type": "setBlock",
            "number": "evilBat",
            "loc": [
                [
                    7,
                    8
                ]
            ]
        },
        {
            "type": "setBlock",
            "number": "evilBat",
            "loc": [
                [
                    5,
                    10
                ]
            ]
        },
        {
            "type": "setBlock",
            "number": "evilBat",
            "loc": [
                [
                    7,
                    10
                ]
            ]
        },
        {
            "type": "setBlock",
            "number": "steelGuard",
            "loc": [
                [
                    3,
                    3
                ]
            ]
        },
        {
            "type": "setBlock",
            "number": "steelGuard",
            "loc": [
                [
                    9,
                    3
                ]
            ]
        },
        {
            "type": "setBlock",
            "number": "steelGuard",
            "loc": [
                [
                    4,
                    5
                ]
            ]
        },
        {
            "type": "setBlock",
            "number": "steelGuard",
            "loc": [
                [
                    8,
                    5
                ]
            ]
        },
        {
            "type": "setBlock",
            "number": "steelGuard",
            "loc": [
                [
                    4,
                    7
                ]
            ]
        },
        {
            "type": "setBlock",
            "number": "steelGuard",
            "loc": [
                [
                    8,
                    7
                ]
            ]
        },
        {
            "type": "setBlock",
            "number": "steelGuard",
            "loc": [
                [
                    3,
                    9
                ]
            ]
        },
        {
            "type": "setBlock",
            "number": "steelGuard",
            "loc": [
                [
                    9,
                    9
                ]
            ]
        },
        {
            "type": "closeDoor",
            "id": "specialDoor",
            "loc": [
                6,
                5
            ]
        },
        {
            "type": "closeDoor",
            "id": "specialDoor",
            "loc": [
                5,
                6
            ]
        },
        {
            "type": "closeDoor",
            "id": "specialDoor",
            "loc": [
                7,
                6
            ]
        },
        {
            "type": "closeDoor",
            "id": "specialDoor",
            "loc": [
                6,
                7
            ]
        },
        "\t[纳可]那么，现在呢？",
        "\t[左阿]什么？这，这是——\n该死，一群怨灵竟也跑来凑热闹。",
        "\t[纳可]被你杀死的云霄级强者，\n他们的亡灵被束缚在这片结界之中，\n久久不能甘心散去。",
        "\t[纳可]这道灵魂印记，加上他们的力量，\n能否将你镇压在此呢？\n回答我的问题，左阿前辈。",
        "\t[左阿]该死，若非被你身上的印记所困，\n早在你进入幻境的一开始，\n我就会杀了你——",
        "\t[纳可]从记事起就生活在阴暗的角落里，\n连一丝阳光都见不到……\n左阿前辈，我会送你解脱的。",
        "每击败一只【心之灵】，\n都能获得1点【灵魂之力】，\n并补充1000亿生命！",
        "当灵魂之力累计到5、10点后，你的生命增加20%！\n累计到15、20点后，你的攻防上升1亿！\n累计到25点后，封印将会完成！",
        "封印完成后，\n左阿的实力将被削弱\r[aqua]10081\r倍，\n与纳可进入最终的决战！"
    ],
    "eachArrive": [],
    "parallelDo": "var lastTime = core.getFlag('lastTime', 0);\n\nif (Date.now() - lastTime > 20) {\n\tvar image = core.material.images.images['03.png'];\n\tvar width = 416,\n\t\theight = 416;\n\n\tcore.canvas.bg.translate(width / 2, height / 2);\n\tcore.canvas.bg.rotate(Math.PI / 180 / 6);\n\tcore.canvas.bg.translate(-width / 2, -height / 2);\n\tcore.canvas.bg.drawImage(image, -288, -96);\n\n\tcore.setFlag('lastTime', Date.now());\n\n\tvar rotateTime = core.getFlag('rotateTime', 0);\n\trotateTime += 1;\n\tif (rotateTime >= 6 * 180) {\n\t\trotateTime -= 6 * 180;\n\t}\n\tcore.setFlag('rotateTime', rotateTime);\n}",
    "events": {
        "6,0": [
            "每击败一只【心之灵】，\n都能获得1点【灵魂之力】，\n并补充1000亿生命！",
            "当灵魂之力累计到5、10点后，你的生命增加20%！\n累计到15、20点后，你的攻防上升2亿！\n累计到25点后，封印将会完成！",
            "封印完成后，\n左阿的实力将被削弱\r[aqua]10081\r倍，\n与纳可进入最终的决战！"
        ]
    },
    "changeFloor": {},
    "beforeBattle": {},
    "afterBattle": {
        "6,6": [
            {
                "type": "if",
                "condition": "(flag:350score==1)",
                "true": [
                    "嗯？想打完后面再回来记一次分嘛？\n门都没有！三个门都被关闭了。",
                    "不过探索精神可嘉，\n那就勉为其难给你一个特别奖励吧。\n……这不代表喵没有生气！！",
                    {
                        "type": "setValue",
                        "name": "item:I1135",
                        "value": "1"
                    }
                ],
                "false": [
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
                        "text": "【第三幕】已结束。可以登录后在这里提交成绩，\n防止存档丢失。你可以选择以下三种计分方式。\n\n在【天之门】中，一把绿钥匙计为100兆分数，\n因此成绩的排头数字将代表你的绿钥匙数量。\n你保留下的绿钥匙越多，对于分数就越有利。\n\n【生之门】将记录为你当前生命/100。\n\n【匙之门】则只看持有的道具数量。\n权值为：黄钥匙1、蓝钥匙3、\n红钥匙/破墙镐/飞行器10、绿钥匙25。",
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
                                        "operator": "/=",
                                        "value": "100"
                                    },
                                    {
                                        "type": "setValue",
                                        "name": "status:hp",
                                        "operator": "+=",
                                        "value": "item:greenKey*1e14"
                                    },
                                    {
                                        "type": "win",
                                        "reason": "第三幕 - 天之门",
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
                                        "type": "setValue",
                                        "name": "status:hp",
                                        "operator": "/=",
                                        "value": "100"
                                    },
                                    {
                                        "type": "win",
                                        "reason": "第三幕 - 生之门",
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
                                        "reason": "第三幕 - 匙之门",
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
                                        "type": "setValue",
                                        "name": "item:I954",
                                        "value": "1"
                                    },
                                    {
                                        "type": "setValue",
                                        "name": "flag:350score",
                                        "value": "1"
                                    },
                                    {
                                        "type": "changeFloor",
                                        "floorId": "MT351",
                                        "loc": [
                                            7,
                                            8
                                        ],
                                        "direction": "up"
                                    }
                                ]
                            }
                        ]
                    }
                ]
            }
        ]
    },
    "afterGetItem": {},
    "afterOpenDoor": {},
    "autoEvent": {},
    "cannotMove": {},
    "cannotMoveIn": {},
    "map": [
    [1035,1035,1035,1035,1035,1035,80176,1035,1035,1035,1035,1035,1035],
    [1035,1035,  0,  0,  0,  0,  0,  0,  0,  0,  0,1035,1035],
    [1035,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,1035],
    [1035,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,1035],
    [1035,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,1035],
    [1035,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,1035],
    [1035,  0,  0,  0,  0,  0,327,  0,  0,  0,  0,  0,1035],
    [1035,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,1035],
    [1035,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,1035],
    [1035,1035,  0,  0,  0,  0,  0,  0,  0,  0,  0,1035,1035],
    [1035,1035,1035,  0,  0,  0,  0,  0,  0,  0,1035,1035,1035],
    [1035,  0,1035,1035,  0,  0,  0,  0,  0,1035,1035,  0,1035],
    [622,1035,1035,1035,1035,1035,1035,1035,1035,1035,1035,1035,622]
],
    "bgmap": [

],
    "fgmap": [

],
    "bg2map": [

],
    "fg2map": [

]
}
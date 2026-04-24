main.floors.MT200=
{
    "floorId": "MT200",
    "title": "200 层",
    "name": "200 层",
    "width": 13,
    "height": 13,
    "canFlyTo": true,
    "canFlyFrom": true,
    "canUseQuickShop": true,
    "cannotViewMap": false,
    "images": [],
    "ratio": 10000,
    "defaultGround": 970,
    "bgm": "13.mp3",
    "firstArrive": [
        "\t[舰船中枢B6]警报！警报！\n不明来历生命体已经抵达核心区域！\n启用主战中枢，执行紧急清扫程序——",
        {
            "type": "function",
            "function": "function(){\ncore.drawWarning(6, 8, '舰船中枢B6')\n}"
        },
        {
            "type": "sleep",
            "time": 3000,
            "noSkip": true
        },
        "\t[纳可]怎么办啊姐姐……\n这个家伙，我们好像也打不赢啊。",
        "\t[纳娜米]居然是主战中枢吗？\n这下麻烦了。在特殊情况下，\n这种东西可是也能行使战斗职能的。",
        "\t[纳娜米]足足天空级六阶……\n还不止，这只是材料强度，\n它真实的破坏力，恐怕更加超乎想象。",
        "\t[纳娜米]我手上的这把镭射枪，\n虽然启用最大功率能够破坏它，\n可它的行动速度太快了。",
        "\t[纳娜米]若是它一直处于高速移动之中，\n就完全无法进行瞄准呢。",
        "\t[纳可]姐姐，这里就……就交给可可吧。",
        "\t[纳可]由我去把它拖住，然后姐姐用镭射枪，\n打碎它的翅膀，让它失去行动能力！",
        "\t[纳娜米]可可……\n事到如今也只好这样了，\n但不要逞强，一旦无法支撑，马上和姐姐一起逃走！",
        "\t[纳可]明白！",
        "系统提示：请在【舰船中枢B6】的攻击之下，\n坚持10回合的时间，为纳娜米争取机会！"
    ],
    "eachArrive": [],
    "parallelDo": "",
    "events": {},
    "changeFloor": {
        "6,4": {
            "floorId": ":before",
            "stair": "upFloor"
        }
    },
    "beforeBattle": {},
    "afterBattle": {
        "6,8": [
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
                "text": "【第二幕】已结束。可以登录后在这里提交成绩，\n防止存档丢失。你可以选择以下三种计分方式。\n\n在【天之门】中，一把绿钥匙计为100兆分数，\n因此成绩的排头数字将代表你的绿钥匙数量。\n你保留下的绿钥匙越多，对于分数就越有利。\n\n【生之门】将记录为你当前生命。\n\n【匙之门】则只看持有的道具数量。\n权值为：黄钥匙1、蓝钥匙3、\n红钥匙/破墙镐/飞行器10、绿钥匙25。",
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
                                "reason": "第二幕 - 天之门",
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
                                "reason": "第二幕 - 生之门",
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
                                "reason": "第二幕 - 匙之门",
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
                                "name": "item:I953",
                                "value": "1"
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
                                "type": "unfollow",
                                "name": "nanami.png"
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
                            "据统计，这一次围剿天外来客，\n以及之后的宝物之争，有数百云霄级强者，\n不计其数的大地、天空级陨落。",
                            "然而，似乎所有人都已经习以为常一般。\n始终处于一种“有秩序的混乱”之中的血洛大陆，\n强者的陨落不过是家常便饭。",
                            "“天外来客”留下的众多宝物，\n也注定将是一个个契机，\n由此，又一批新的强者将会诞生。",
                            "事件平息后，\n声律领的人们在废墟上重建家园，\n这方世界也重归于旧有的秩序。",
                            "——人们本以为会是这样，\n可还是产生了一些意外。",
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
    },
    "afterGetItem": {},
    "afterOpenDoor": {},
    "autoEvent": {},
    "cannotMove": {},
    "cannotMoveIn": {},
    "map": [
    [190322,190323,156,156,156,156,1500,156,156,156,156,190326,190327],
    [190330,190331,  4,  4,  4,  4,  4,  4,  4,  4,  4,190334,190335],
    [  4,  4,  4,  4,  4,  4,  4,  4,  4,  4,  4,  4,  4],
    [  4,  4,156,156,156,156,156,156,156,156,156,  4,  4],
    [156,156,156,  0,572,  0, 88,  0,572,  0,156,156,156],
    [  4,  4,  4,572,  0, 60,  0, 60,  0,572,  4,  4,  4],
    [  4, 61, 84,  0, 60,  0,619,  0, 60,  0, 84, 61,  4],
    [  4,  4,  4,572,  0, 60,  0, 60,  0,572,  4,  4,  4],
    [156,156,156,  0,572,  0,493,  0,572,  0,156,156,156],
    [  4,  4,156,156,156,156,156,156,156,156,156,  4,  4],
    [  4,  4,  4,  4,  4,  4,  4,  4,  4,  4,  4,  4,  4],
    [190352,190353,  4,  4,  4,  4,  4,  4,  4,  4,  4,190324,190325],
    [190360,190361,156,156,156,156,156,156,156,156,156,190332,190333]
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
main.floors.MT140=
{
    "floorId": "MT140",
    "title": "140 层",
    "name": "140 层",
    "width": 13,
    "height": 13,
    "canFlyTo": true,
    "canFlyFrom": true,
    "canUseQuickShop": true,
    "cannotViewMap": false,
    "images": [],
    "ratio": 500,
    "defaultGround": 917,
    "bgm": "9.mp3",
    "firstArrive": [
        "\t[纳可]不知不觉……居然走到了核心区域。\n生活在这里的“灵”也是一等一的强大。",
        "\t[纳可]恐怕每一个，都不逊色于当日的【百方】……\n不过如今的我，已经拥有了和它们交战的实力！",
        "\t[灵]我……是……谁？嗷呜——",
        "\t[纳可]对不起，为了家族秘境的稳定，\n为了纳鹰前辈的栖身之地不被暴露，\n请你们的意识……回归自然吧。"
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
                    "condition": "(flag:140f==0)",
                    "true": [
                        {
                            "type": "setCurtain",
                            "color": [
                                0,
                                0,
                                0,
                                1
                            ],
                            "time": 1000,
                            "keep": true
                        },
                        "自秘境之行后，便是两年过去。\n纳可已经不再是曾经那个懵懂无知，\n只身一人闯入地宫的少女了。",
                        "以她如今的实力，在燕岗领，\n也算得上是名副其实的天才了。\n但对于她的目标而言，这种程度显然还不够。",
                        "她在等，等待新的变强的机会，\n以在未来能够报答纳家先祖对她的栽培之恩。",
                        "直到这一天，平静的生活终于被打破，\n一则消息，震动了周遭的十数座领地主城。",
                        "来自【天外族群】的一位来客，\n在声律领之内被发现，\n并被一众血洛世界强者成功击杀！",
                        "各方势力收到消息，\n乃是第一时间便赶往了此次事发地点——\n如今已经化为废墟的，声律城。",
                        {
                            "type": "changeFloor",
                            "floorId": "MT141",
                            "loc": [
                                6,
                                1
                            ],
                            "direction": "down"
                        },
                        {
                            "type": "setCurtain",
                            "time": 1000
                        }
                    ],
                    "false": [
                        {
                            "type": "changeFloor",
                            "floorId": "MT141",
                            "loc": [
                                6,
                                1
                            ],
                            "direction": "down"
                        }
                    ]
                }
            ]
        }
    },
    "changeFloor": {
        "3,11": {
            "floorId": ":before",
            "stair": "upFloor"
        },
        "9,11": {
            "floorId": "MT140",
            "loc": [
                6,
                8
            ]
        },
        "6,8": {
            "floorId": "MT140",
            "loc": [
                9,
                11
            ]
        }
    },
    "beforeBattle": {},
    "afterBattle": {
        "4,3": [
            {
                "type": "setValue",
                "name": "flag:door_MT140_5_1",
                "operator": "+=",
                "value": "1"
            }
        ],
        "8,3": [
            {
                "type": "setValue",
                "name": "flag:door_MT140_5_1",
                "operator": "+=",
                "value": "1"
            }
        ],
        "3,4": [
            {
                "type": "setValue",
                "name": "flag:door_MT140_5_1",
                "operator": "+=",
                "value": "1"
            }
        ],
        "5,4": [
            {
                "type": "setValue",
                "name": "flag:door_MT140_5_1",
                "operator": "+=",
                "value": "1"
            }
        ],
        "7,4": [
            {
                "type": "setValue",
                "name": "flag:door_MT140_5_1",
                "operator": "+=",
                "value": "1"
            }
        ],
        "9,4": [
            {
                "type": "setValue",
                "name": "flag:door_MT140_5_1",
                "operator": "+=",
                "value": "1"
            }
        ],
        "4,5": [
            {
                "type": "setValue",
                "name": "flag:door_MT140_5_1",
                "operator": "+=",
                "value": "1"
            }
        ],
        "6,5": [
            {
                "type": "setValue",
                "name": "flag:door_MT140_5_1",
                "operator": "+=",
                "value": "1"
            }
        ],
        "8,5": [
            {
                "type": "setValue",
                "name": "flag:door_MT140_5_1",
                "operator": "+=",
                "value": "1"
            }
        ]
    },
    "afterGetItem": {},
    "afterOpenDoor": {},
    "autoEvent": {
        "5,1": {
            "0": {
                "condition": "flag:door_MT140_5_1==9",
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
                        "name": "flag:door_MT140_5_1",
                        "operator": "=",
                        "value": "null"
                    }
                ]
            },
            "1": null
        },
        "6,0": {
            "0": {
                "condition": "flag:door_MT140_5_1==9",
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
                        "name": "flag:door_MT140_5_1",
                        "value": "null"
                    }
                ]
            }
        },
        "7,1": {
            "0": {
                "condition": "flag:door_MT140_5_1==9",
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
                        "name": "flag:door_MT140_5_1",
                        "operator": "=",
                        "value": "null"
                    }
                ]
            }
        },
        "6,2": {
            "0": {
                "condition": "flag:door_MT140_5_1==9",
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
                        "name": "flag:door_MT140_5_1",
                        "operator": "=",
                        "value": "null"
                    }
                ]
            }
        }
    },
    "cannotMove": {},
    "cannotMoveIn": {},
    "map": [
    [397,151,151,151,151,151, 85,151,151,151,151,151,397],
    [151,151,151,151,151, 85, 87, 85,151,151,151,151,151],
    [151,151,151,151,  0, 60, 85, 60,  0,151,151,151,151],
    [151,151,151,  0,416,  0, 60,  0,416,  0,151,151,151],
    [151,151,  0,417,  0,417,  0,417,  0,417,  0,151,151],
    [151,151,619,  0,415,  0,415,  0,415,  0,619,151,151],
    [151,151,151,151,  0,  0,620,  0,  0,151,151,151,151],
    [151,151,151,151,151, 47,  0, 47,151,151,151,151,151],
    [151,151,619,619, 83,  0,104,  0, 83,619,619,151,151],
    [151,151,151,151,151,151,151,151,151,151,151,151,151],
    [151,151,151,151,151,151,151,151,151,151,151,151,151],
    [151,151,151, 88, 21,576,418,577, 21,104,151,151,151],
    [397,151,151,151,151,151,151,151,151,151,151,151,397]
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
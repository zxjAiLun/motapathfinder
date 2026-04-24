main.floors.MT735=
{
    "floorId": "MT735",
    "title": "735 层",
    "name": "735 层",
    "width": 13,
    "height": 13,
    "canFlyTo": true,
    "canFlyFrom": true,
    "canUseQuickShop": true,
    "cannotViewMap": false,
    "images": [],
    "ratio": 2000000000000,
    "defaultGround": 430069,
    "bgm": "38.mp3",
    "weather": [
        "sun",
        2
    ],
    "firstArrive": [],
    "eachArrive": [],
    "parallelDo": "",
    "events": {
        "6,6": {
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
                "一段剧情。\n经验增加了1兆！",
                {
                    "type": "setValue",
                    "name": "status:exp",
                    "operator": "+=",
                    "value": "1e12"
                },
                "在天道洗礼之下，得到【赌之神帝】的力量加持！\n角色全属性暂时提升100.81倍！\n古龙奥利维尔全属性下降了10倍，所有属性失效！",
                {
                    "type": "setValue",
                    "name": "item:I821",
                    "value": "100.81"
                },
                {
                    "type": "setEnemyOnPoint",
                    "loc": [
                        [
                            6,
                            6
                        ]
                    ],
                    "name": "atk",
                    "operator": "/=",
                    "value": "10"
                },
                {
                    "type": "setEnemyOnPoint",
                    "loc": [
                        [
                            6,
                            6
                        ]
                    ],
                    "name": "def",
                    "operator": "/=",
                    "value": "10"
                },
                {
                    "type": "setEnemyOnPoint",
                    "loc": [
                        [
                            6,
                            6
                        ]
                    ],
                    "name": "hp",
                    "operator": "/=",
                    "value": "10"
                },
                {
                    "type": "callBook"
                },
                {
                    "type": "battle",
                    "loc": [
                        6,
                        6
                    ]
                },
                {
                    "type": "setValue",
                    "name": "item:I821",
                    "value": "0"
                }
            ]
        },
        "2,8": [
            {
                "type": "choices",
                "text": "\t[绿色按钮,A985]如果觉得打不动的话，\n不妨来点补给再前进吧！\n又或者，如果你更喜欢绿钥匙……？",
                "choices": [
                    {
                        "text": "获得10把绿钥匙",
                        "color": [
                            75,
                            217,
                            63,
                            1
                        ],
                        "need": "flag:735f<1",
                        "action": [
                            {
                                "type": "animate",
                                "name": "green"
                            },
                            {
                                "type": "setValue",
                                "name": "item:greenKey",
                                "operator": "+=",
                                "value": "10"
                            },
                            {
                                "type": "setValue",
                                "name": "flag:735f",
                                "operator": "+=",
                                "value": "1"
                            }
                        ]
                    },
                    {
                        "text": "获得5把绿钥匙、1瓶灵水",
                        "color": [
                            118,
                            209,
                            125,
                            1
                        ],
                        "need": "flag:735f<1",
                        "action": [
                            {
                                "type": "animate",
                                "name": "green"
                            },
                            {
                                "type": "setValue",
                                "name": "item:greenKey",
                                "operator": "+=",
                                "value": "5"
                            },
                            {
                                "type": "setValue",
                                "name": "item:superWine",
                                "operator": "+=",
                                "value": "1"
                            },
                            {
                                "type": "setValue",
                                "name": "flag:735f",
                                "operator": "+=",
                                "value": "1"
                            },
                            {
                                "type": "setValue",
                                "name": "flag:saltygreen",
                                "operator": "+=",
                                "value": "5"
                            }
                        ]
                    },
                    {
                        "text": "获得1瓶圣水",
                        "color": [
                            167,
                            217,
                            167,
                            1
                        ],
                        "need": "flag:735f<1",
                        "action": [
                            {
                                "type": "animate",
                                "name": "green"
                            },
                            {
                                "type": "setValue",
                                "name": "item:superPotion",
                                "operator": "+=",
                                "value": "1"
                            },
                            {
                                "type": "setValue",
                                "name": "flag:735f",
                                "operator": "+=",
                                "value": "1"
                            },
                            {
                                "type": "setValue",
                                "name": "flag:saltygreen",
                                "operator": "+=",
                                "value": "10"
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
        "10,8": [
            {
                "type": "choices",
                "text": "\t[绿色按钮,A985]如果觉得打不动的话，\n不妨来点补给再前进吧！\n又或者，如果你更喜欢绿钥匙……？",
                "choices": [
                    {
                        "text": "获得10把绿钥匙",
                        "color": [
                            75,
                            217,
                            63,
                            1
                        ],
                        "need": "flag:735f2<1",
                        "action": [
                            {
                                "type": "animate",
                                "name": "green"
                            },
                            {
                                "type": "setValue",
                                "name": "item:greenKey",
                                "operator": "+=",
                                "value": "10"
                            },
                            {
                                "type": "setValue",
                                "name": "flag:735f2",
                                "operator": "+=",
                                "value": "1"
                            }
                        ]
                    },
                    {
                        "text": "获得5把绿钥匙、1瓶灵水",
                        "color": [
                            118,
                            209,
                            125,
                            1
                        ],
                        "need": "flag:735f2<1",
                        "action": [
                            {
                                "type": "animate",
                                "name": "green"
                            },
                            {
                                "type": "setValue",
                                "name": "item:greenKey",
                                "operator": "+=",
                                "value": "5"
                            },
                            {
                                "type": "setValue",
                                "name": "item:superWine",
                                "operator": "+=",
                                "value": "1"
                            },
                            {
                                "type": "setValue",
                                "name": "flag:735f2",
                                "operator": "+=",
                                "value": "1"
                            },
                            {
                                "type": "setValue",
                                "name": "flag:saltygreen",
                                "operator": "+=",
                                "value": "5"
                            }
                        ]
                    },
                    {
                        "text": "获得1瓶圣水",
                        "color": [
                            167,
                            217,
                            167,
                            1
                        ],
                        "need": "flag:735f2<1",
                        "action": [
                            {
                                "type": "animate",
                                "name": "green"
                            },
                            {
                                "type": "setValue",
                                "name": "item:superPotion",
                                "operator": "+=",
                                "value": "1"
                            },
                            {
                                "type": "setValue",
                                "name": "flag:735f2",
                                "operator": "+=",
                                "value": "1"
                            },
                            {
                                "type": "setValue",
                                "name": "flag:saltygreen",
                                "operator": "+=",
                                "value": "10"
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
        "6,12": {
            "floorId": ":before",
            "stair": "upFloor"
        }
    },
    "beforeBattle": {},
    "afterBattle": {
        "6,6": [
            {
                "type": "hide",
                "loc": [
                    [
                        5,
                        4
                    ]
                ],
                "remove": true
            },
            {
                "type": "hide",
                "loc": [
                    [
                        5,
                        5
                    ]
                ],
                "remove": true
            },
            {
                "type": "hide",
                "loc": [
                    [
                        5,
                        6
                    ]
                ],
                "remove": true
            },
            {
                "type": "hide",
                "loc": [
                    [
                        6,
                        4
                    ]
                ],
                "remove": true
            },
            {
                "type": "hide",
                "loc": [
                    [
                        6,
                        5
                    ]
                ],
                "remove": true
            },
            {
                "type": "hide",
                "loc": [
                    [
                        7,
                        4
                    ]
                ],
                "remove": true
            },
            {
                "type": "hide",
                "loc": [
                    [
                        7,
                        5
                    ]
                ],
                "remove": true
            },
            {
                "type": "hide",
                "loc": [
                    [
                        7,
                        6
                    ]
                ],
                "remove": true
            },
            "一长段剧情……\n场景变换。",
            {
                "type": "changeFloor",
                "floorId": "MT736",
                "loc": [
                    6,
                    11
                ],
                "direction": "up"
            },
            {
                "type": "setValue",
                "name": "item:I1179",
                "value": "0"
            }
        ]
    },
    "afterGetItem": {},
    "afterOpenDoor": {},
    "autoEvent": {},
    "cannotMove": {},
    "cannotMoveIn": {},
    "map": [
    [281201,281177,  0,281193,  0,280387,280388,280389,  0,281193,  0,281177,281201],
    [281209,281176, 17,  0,  0,280395,280396,280397,  0,  0, 17,281176,281209],
    [281176,281176, 17,  0,281194,280403,280404,280405,281194,  0, 17,281176,281176],
    [289,289, 17, 17,  0,  0,281214,  0,  0, 17, 17,289,289],
    [289,289, 17, 17,  0,2062,2065,2067,  0, 17, 17,289,289],
    [289,289, 17, 17, 17,2063,2066,2068, 17, 17, 17,289,289],
    [289,281178,281178, 17, 17,2064,1942,2069, 17, 17,281178,281178,289],
    [289,281178,281178,281178, 17,  0,  0,  0, 17,281178,281178,281178,289],
    [289,289,985,  0, 17,  0,  0,  0, 17,  0,985,289,289],
    [281176,289,289,1179,  0,  0,  0,  0,  0,1179,289,289,281176],
    [289,289,289,289,281211,281177,  0,281177,281211,289,289,289,289],
    [289,289,281179,281176,281176,  0,  0,  0,281176,281176,281179,289,289],
    [281180,281178,281178,281178,281178,  0, 88,  0,281178,281178,281178,281178,281180]
],
    "bgmap": [

],
    "fgmap": [
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,281206,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,281203,  0,  0,  0,281203,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0]
],
    "bg2map": [
    [  0,  0,430064,430092,280395,280396,  0,280396,280397,430093,430066,  0,  0],
    [  0,  0,430072,430056,280403,280404,  0,280404,280405,430058,430074,  0,  0],
    [  0,  0,430072,430064,430092,  0,  0,  0,430093,430066,430074,  0,  0],
    [  0,  0,430072,430072,430056,  0,  0,  0,430058,430074,430074,  0,  0],
    [  0,  0,430072,430072,430064,  0,  0,  0,430066,430074,430074,  0,  0],
    [  0,  0,430080,430072,430072,430111,430111,430111,430074,430074,430082,  0,  0],
    [  0,  0,  0,430080,430072,430111,430111,430111,430074,430082,  0,  0,  0],
    [  0,  0,  0,  0,430072,430111,430111,430111,430074,  0,  0,  0,  0],
    [  0,  0,  0,  0,430080,430111,430111,430111,430082,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0]
],
    "fg2map": [

]
}
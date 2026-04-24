main.floors.MT825=
{
    "floorId": "MT825",
    "title": "825 层",
    "name": "825 层",
    "width": 13,
    "height": 13,
    "canFlyTo": true,
    "canFlyFrom": true,
    "canUseQuickShop": true,
    "cannotViewMap": false,
    "images": [
        {
            "name": "16.jpg",
            "canvas": "bg",
            "x": 0,
            "y": 0,
            "sx": 0,
            "sy": 0
        }
    ],
    "ratio": 50000000000000,
    "defaultGround": 906,
    "bgm": "42.mp3",
    "firstArrive": [],
    "eachArrive": [],
    "parallelDo": "",
    "events": {
        "0,9": [
            {
                "type": "jumpHero",
                "loc": [
                    0,
                    13
                ],
                "time": 500
            },
            {
                "type": "changeFloor",
                "floorId": "MT824",
                "loc": [
                    0,
                    -1
                ],
                "direction": "down"
            },
            {
                "type": "jumpHero",
                "loc": [
                    0,
                    11
                ],
                "time": 800
            }
        ],
        "12,9": [
            {
                "type": "jumpHero",
                "loc": [
                    12,
                    13
                ],
                "time": 500
            },
            {
                "type": "changeFloor",
                "floorId": "MT824",
                "loc": [
                    12,
                    -1
                ],
                "direction": "down"
            },
            {
                "type": "jumpHero",
                "loc": [
                    12,
                    11
                ],
                "time": 800
            }
        ],
        "3,8": [
            {
                "type": "jumpHero",
                "loc": [
                    6,
                    7
                ],
                "time": 500
            },
            {
                "type": "moveHero",
                "steps": [
                    "up:2"
                ]
            },
            {
                "type": "changePos",
                "direction": "up"
            },
            "一段非常长的剧情。\n芢利，你的末日到了！",
            "反抗军将全部实力投射在时光殿上！\n角色全属性暂时提升100.81倍！",
            {
                "type": "setValue",
                "name": "item:I821",
                "value": "100.81"
            },
            {
                "type": "callBook"
            },
            {
                "type": "battle",
                "loc": [
                    6,
                    2
                ]
            },
            {
                "type": "setValue",
                "name": "item:I821",
                "value": "0"
            },
            {
                "type": "setBlock",
                "number": "E1827",
                "loc": [
                    [
                        6,
                        2
                    ]
                ]
            },
            {
                "type": "setCurtain",
                "color": [
                    0,
                    0,
                    0,
                    0.3
                ],
                "time": 1500,
                "keep": true
            }
        ],
        "9,8": [
            {
                "type": "jumpHero",
                "loc": [
                    6,
                    7
                ],
                "time": 500
            },
            {
                "type": "moveHero",
                "steps": [
                    "up:2"
                ]
            },
            {
                "type": "changePos",
                "direction": "up"
            },
            "一段非常长的剧情。\n芢利，你的末日到了！",
            "反抗军将全部实力投射在时光殿上！\n角色全属性暂时提升100.81倍！",
            {
                "type": "setValue",
                "name": "item:I821",
                "value": "100.81"
            },
            {
                "type": "callBook"
            },
            {
                "type": "battle",
                "loc": [
                    6,
                    2
                ]
            },
            {
                "type": "setValue",
                "name": "item:I821",
                "value": "0"
            },
            {
                "type": "setBlock",
                "number": "E1827",
                "loc": [
                    [
                        6,
                        2
                    ]
                ]
            },
            {
                "type": "setCurtain",
                "color": [
                    0,
                    0,
                    0,
                    0.3
                ],
                "time": 1500,
                "keep": true
            }
        ],
        "1,7": {
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
            "data": []
        },
        "3,7": {
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
            "data": []
        },
        "9,7": {
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
            "data": []
        },
        "11,7": {
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
            "data": []
        },
        "0,7": [
            {
                "type": "choices",
                "text": "\t[绿色按钮,A985]如果觉得打不动的话，\n不妨来点补给再前进吧！\n又或者，如果你更喜欢绿钥匙……？",
                "choices": [
                    {
                        "text": "获得9把绿钥匙",
                        "color": [
                            75,
                            217,
                            63,
                            1
                        ],
                        "need": "flag:825f<1",
                        "action": [
                            {
                                "type": "animate",
                                "name": "green"
                            },
                            {
                                "type": "setValue",
                                "name": "item:greenKey",
                                "operator": "+=",
                                "value": "9"
                            },
                            {
                                "type": "setValue",
                                "name": "flag:825f",
                                "operator": "+=",
                                "value": "1"
                            }
                        ]
                    },
                    {
                        "text": "获得5把绿钥匙、400垓生命",
                        "color": [
                            118,
                            209,
                            125,
                            1
                        ],
                        "need": "flag:825f<1",
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
                                "name": "status:hp",
                                "operator": "+=",
                                "value": "400e20"
                            },
                            {
                                "type": "setValue",
                                "name": "flag:825f",
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
                        "text": "获得900垓生命",
                        "color": [
                            167,
                            217,
                            167,
                            1
                        ],
                        "need": "flag:825f<1",
                        "action": [
                            {
                                "type": "animate",
                                "name": "green"
                            },
                            {
                                "type": "setValue",
                                "name": "flag:825f",
                                "operator": "+=",
                                "value": "1"
                            },
                            {
                                "type": "setValue",
                                "name": "status:hp",
                                "operator": "+=",
                                "value": "900e20"
                            },
                            {
                                "type": "setValue",
                                "name": "flag:saltygreen",
                                "operator": "+=",
                                "value": "9"
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
        "12,7": [
            {
                "type": "choices",
                "text": "\t[绿色按钮,A985]如果觉得打不动的话，\n不妨来点补给再前进吧！\n又或者，如果你更喜欢绿钥匙……？",
                "choices": [
                    {
                        "text": "获得9把绿钥匙",
                        "color": [
                            75,
                            217,
                            63,
                            1
                        ],
                        "need": "flag:825f2<1",
                        "action": [
                            {
                                "type": "animate",
                                "name": "green"
                            },
                            {
                                "type": "setValue",
                                "name": "item:greenKey",
                                "operator": "+=",
                                "value": "9"
                            },
                            {
                                "type": "setValue",
                                "name": "flag:825f2",
                                "operator": "+=",
                                "value": "1"
                            }
                        ]
                    },
                    {
                        "text": "获得5把绿钥匙、400垓生命",
                        "color": [
                            118,
                            209,
                            125,
                            1
                        ],
                        "need": "flag:825f2<1",
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
                                "name": "status:hp",
                                "operator": "+=",
                                "value": "400e20"
                            },
                            {
                                "type": "setValue",
                                "name": "flag:825f2",
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
                        "text": "获得900垓生命",
                        "color": [
                            167,
                            217,
                            167,
                            1
                        ],
                        "need": "flag:825f2<1",
                        "action": [
                            {
                                "type": "animate",
                                "name": "green"
                            },
                            {
                                "type": "setValue",
                                "name": "flag:825f2",
                                "operator": "+=",
                                "value": "1"
                            },
                            {
                                "type": "setValue",
                                "name": "status:hp",
                                "operator": "+=",
                                "value": "900e20"
                            },
                            {
                                "type": "setValue",
                                "name": "flag:saltygreen",
                                "operator": "+=",
                                "value": "9"
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
    [  0,  0,2018,  0,1824,  0,1824,  0,1824,  0,2018,  0,  0],
    [  0,2010,  0,2025,  0,1825,  0,1825,  0,2025,  0,2010,  0],
    [2018,  0,2010,  0,2025,  0,1827,  0,2025,  0,2010,  0,2018],
    [  0,2010,  0,  0,  0,  0,  0,  0,  0,  0,  0,2010,  0],
    [2018,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,2018],
    [  0,  0,  0,  0,  0,2139,  0,2140,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,2138,  0,  0,  0,2137,  0,  0,  0,  0],
    [985,2141, 17,2142,  0,  0,  0,  0,  0,2141, 17,2142,985],
    [  0,1487,  0,692, 17,  0,  0,  0, 17,691,  0,1487,  0],
    [  0,  0,490321, 17, 17, 17, 17, 17, 17, 17,490321,  0,  0],
    [ 17, 17, 17, 17, 17, 17, 17, 17, 17, 17, 17, 17, 17],
    [ 17, 17, 17, 17, 17, 17, 17, 17, 17, 17, 17, 17, 17],
    [ 17, 17, 17, 17, 17, 17, 17, 17, 17, 17, 17, 17, 17]
],
    "bgmap": [

],
    "fgmap": [
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,510789],
    [510665,510666,510667,  0,  0,  0,  0,  0,  0,  0,510787,510788,510789],
    [510673,510674,510675,  0,510677,510678,510679,510792,510793,510794,510795,510796,510797],
    [510681,510682,510683,  0,510685,510686,510687,510800,510801,510802,510803,510804,510805],
    [510689,510690,510691,510692,510693,510694,510695,510808,510809,510810,510811,510812,510813],
    [510697,510698,510699,510700,510701,510702,510703,510816,510817,510818,510819,510820,510821]
],
    "bg2map": [
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [320207,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,320207],
    [320207,320207,320207,  0,  0,  0,  0,  0,  0,  0,320207,320207,320207],
    [320207,320207,  0,  0,  0,  0,  0,  0,  0,  0,  0,320207,320207],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0]
],
    "fg2map": [
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [694,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,694],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0]
]
}
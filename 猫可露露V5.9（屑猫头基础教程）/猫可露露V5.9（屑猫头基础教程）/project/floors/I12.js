main.floors.I12=
{
    "floorId": "I12",
    "title": "心境 I12",
    "name": "心境 I12",
    "width": 13,
    "height": 13,
    "canFlyTo": true,
    "canFlyFrom": true,
    "canUseQuickShop": true,
    "cannotViewMap": false,
    "images": [],
    "ratio": 10000000000,
    "defaultGround": 400097,
    "bgm": "31.mp3",
    "weather": [
        "cloud",
        4
    ],
    "firstArrive": [],
    "eachArrive": [],
    "parallelDo": "",
    "events": {
        "6,12": [
            {
                "type": "if",
                "condition": "(flag:x9==9)",
                "true": [
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
                        "type": "if",
                        "condition": "(flag:xun==0)",
                        "true": [
                            {
                                "type": "win",
                                "reason": "第九心境"
                            }
                        ],
                        "false": [
                            {
                                "type": "setValue",
                                "name": "status:hp",
                                "operator": "/=",
                                "value": "flag:xun"
                            },
                            {
                                "type": "win",
                                "reason": "第九心境"
                            }
                        ]
                    }
                ],
                "false": [
                    "心境之门前有一道隐形的屏障，\n隔开了纳可的身体与心灵…"
                ]
            }
        ]
    },
    "changeFloor": {
        "0,11": {
            "floorId": ":before",
            "stair": "upFloor"
        }
    },
    "beforeBattle": {},
    "afterBattle": {
        "6,0": [
            {
                "type": "animate",
                "name": "an"
            },
            {
                "type": "setBlock",
                "number": "E1567",
                "loc": [
                    [
                        5,
                        0
                    ]
                ],
                "time": 300
            },
            {
                "type": "setBlock",
                "number": "E1567",
                "loc": [
                    [
                        7,
                        0
                    ]
                ],
                "time": 300
            }
        ],
        "5,0": [
            {
                "type": "setValue",
                "name": "flag:x9",
                "operator": "+=",
                "value": "1"
            },
            {
                "type": "if",
                "condition": "(flag:x9==2)",
                "true": [
                    {
                        "type": "animate",
                        "name": "an"
                    },
                    {
                        "type": "setBlock",
                        "number": "E1567",
                        "loc": [
                            [
                                4,
                                0
                            ]
                        ],
                        "time": 300
                    },
                    {
                        "type": "setBlock",
                        "number": "E1567",
                        "loc": [
                            [
                                4,
                                1
                            ]
                        ],
                        "time": 300
                    },
                    {
                        "type": "setBlock",
                        "number": "E1567",
                        "loc": [
                            [
                                8,
                                0
                            ]
                        ],
                        "time": 300
                    },
                    {
                        "type": "setBlock",
                        "number": "E1567",
                        "loc": [
                            [
                                8,
                                1
                            ]
                        ],
                        "time": 300
                    }
                ],
                "false": []
            }
        ],
        "7,0": [
            {
                "type": "setValue",
                "name": "flag:x9",
                "operator": "+=",
                "value": "1"
            },
            {
                "type": "if",
                "condition": "(flag:x9==2)",
                "true": [
                    {
                        "type": "animate",
                        "name": "an"
                    },
                    {
                        "type": "setBlock",
                        "number": "E1567",
                        "loc": [
                            [
                                4,
                                0
                            ]
                        ],
                        "time": 300
                    },
                    {
                        "type": "setBlock",
                        "number": "E1567",
                        "loc": [
                            [
                                4,
                                1
                            ]
                        ],
                        "time": 300
                    },
                    {
                        "type": "setBlock",
                        "number": "E1567",
                        "loc": [
                            [
                                8,
                                0
                            ]
                        ],
                        "time": 300
                    },
                    {
                        "type": "setBlock",
                        "number": "E1567",
                        "loc": [
                            [
                                8,
                                1
                            ]
                        ],
                        "time": 300
                    }
                ],
                "false": []
            }
        ],
        "4,0": [
            {
                "type": "setValue",
                "name": "flag:x9",
                "operator": "+=",
                "value": "1"
            },
            {
                "type": "if",
                "condition": "(flag:x9==6)",
                "true": [
                    {
                        "type": "setBlock",
                        "number": "A998",
                        "loc": [
                            [
                                6,
                                12
                            ]
                        ],
                        "time": 500
                    },
                    {
                        "type": "animate",
                        "name": "baozha",
                        "loc": [
                            6,
                            11
                        ]
                    },
                    {
                        "type": "setBlock",
                        "number": "lavaNet",
                        "loc": [
                            [
                                6,
                                11
                            ]
                        ],
                        "time": 300
                    },
                    {
                        "type": "setBlock",
                        "number": "lavaNet",
                        "loc": [
                            [
                                5,
                                12
                            ]
                        ],
                        "time": 300
                    },
                    {
                        "type": "setBlock",
                        "number": "lavaNet",
                        "loc": [
                            [
                                7,
                                12
                            ]
                        ],
                        "time": 300
                    }
                ],
                "false": []
            }
        ],
        "4,1": [
            {
                "type": "setValue",
                "name": "flag:x9",
                "operator": "+=",
                "value": "1"
            },
            {
                "type": "if",
                "condition": "(flag:x9==6)",
                "true": [
                    {
                        "type": "setBlock",
                        "number": "A998",
                        "loc": [
                            [
                                6,
                                12
                            ]
                        ],
                        "time": 500
                    },
                    {
                        "type": "animate",
                        "name": "baozha",
                        "loc": [
                            6,
                            11
                        ]
                    },
                    {
                        "type": "setBlock",
                        "number": "lavaNet",
                        "loc": [
                            [
                                6,
                                11
                            ]
                        ],
                        "time": 300
                    },
                    {
                        "type": "setBlock",
                        "number": "lavaNet",
                        "loc": [
                            [
                                5,
                                12
                            ]
                        ],
                        "time": 300
                    },
                    {
                        "type": "setBlock",
                        "number": "lavaNet",
                        "loc": [
                            [
                                7,
                                12
                            ]
                        ],
                        "time": 300
                    }
                ],
                "false": []
            }
        ],
        "8,0": [
            {
                "type": "setValue",
                "name": "flag:x9",
                "operator": "+=",
                "value": "1"
            },
            {
                "type": "if",
                "condition": "(flag:x9==6)",
                "true": [
                    {
                        "type": "setBlock",
                        "number": "A998",
                        "loc": [
                            [
                                6,
                                12
                            ]
                        ],
                        "time": 500
                    },
                    {
                        "type": "animate",
                        "name": "baozha",
                        "loc": [
                            6,
                            11
                        ]
                    },
                    {
                        "type": "setBlock",
                        "number": "lavaNet",
                        "loc": [
                            [
                                6,
                                11
                            ]
                        ],
                        "time": 300
                    },
                    {
                        "type": "setBlock",
                        "number": "lavaNet",
                        "loc": [
                            [
                                5,
                                12
                            ]
                        ],
                        "time": 300
                    },
                    {
                        "type": "setBlock",
                        "number": "lavaNet",
                        "loc": [
                            [
                                7,
                                12
                            ]
                        ],
                        "time": 300
                    }
                ],
                "false": []
            }
        ],
        "8,1": [
            {
                "type": "setValue",
                "name": "flag:x9",
                "operator": "+=",
                "value": "1"
            },
            {
                "type": "if",
                "condition": "(flag:x9==6)",
                "true": [
                    {
                        "type": "setBlock",
                        "number": "A998",
                        "loc": [
                            [
                                6,
                                12
                            ]
                        ],
                        "time": 500
                    },
                    {
                        "type": "animate",
                        "name": "baozha",
                        "loc": [
                            6,
                            11
                        ]
                    },
                    {
                        "type": "setBlock",
                        "number": "lavaNet",
                        "loc": [
                            [
                                6,
                                11
                            ]
                        ],
                        "time": 300
                    },
                    {
                        "type": "setBlock",
                        "number": "lavaNet",
                        "loc": [
                            [
                                5,
                                12
                            ]
                        ],
                        "time": 300
                    },
                    {
                        "type": "setBlock",
                        "number": "lavaNet",
                        "loc": [
                            [
                                7,
                                12
                            ]
                        ],
                        "time": 300
                    }
                ],
                "false": []
            }
        ]
    },
    "afterGetItem": {},
    "afterOpenDoor": {},
    "autoEvent": {},
    "cannotMove": {},
    "cannotMoveIn": {},
    "map": [
    [196,196,196,196,240054,240062,1567,240062,240054,196,196,196,196],
    [196,196,196,196,240062,1562,1437,1562,240062,196,196,196,196],
    [1055,1010,1055,1558,640,  0,1563, 16,643,1557,1055, 15,1010],
    [1055, 15,  0, 16,1055, 83,1055,1010,1055,639,1559,1010,1055],
    [1055,1554,1055,  0,1055,1011,1556,1055, 21,1055,645,1055,1011],
    [1055, 22,1055,1560,639,1055,645,1055,1554, 15,  0,1055,  0],
    [  0,1553,1009,  0,1055, 82,  0, 81,  0,1552,1055,640,1563],
    [1011, 82,1055,1552,1055, 21,1055,1055,1055,  0, 82,  0,400344],
    [1055,  0,1055,  0,1009,1055,1010,  0, 81,1554,1055,1555,1055],
    [1055,1556,641,1055,1553,  0,1555,1055,1055,  0,1010,  0,1055],
    [1055,1055, 81,400344,1055,1055,641,1055,1055,400345, 82,400344,1055],
    [ 88,  0,  0,640, 81,  0,1552, 21,  0, 81,639,400077,400078],
    [1055,1055,400344,1055,1055,400353,  0,400353,1055,1055,1055,400085,400086]
],
    "bgmap": [

],
    "fgmap": [
    [146,146,146,146,  0,  0,  0,  0,  0,146,146,146,146],
    [ 90,  0, 90,  0,  0,  0,  0,  0,  0,  0, 90,  0, 90],
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
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0]
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
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,400054,400054,400054],
    [400054,400054,400054,400054,400054,400054,400054,400054,400054,400054,400054,400054,400054],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,400054,400054,400054]
],
    "fg2map": [

]
}
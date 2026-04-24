main.floors.MT805=
{
    "floorId": "MT805",
    "title": "805 层",
    "name": "805 层",
    "width": 13,
    "height": 13,
    "canFlyTo": true,
    "canFlyFrom": true,
    "canUseQuickShop": true,
    "cannotViewMap": false,
    "images": [
        {
            "name": "14.jpg",
            "canvas": "bg",
            "x": 0,
            "y": 0,
            "sx": 150,
            "sy": 150
        }
    ],
    "ratio": 20000000000000,
    "defaultGround": 906,
    "bgm": "41.mp3",
    "firstArrive": [],
    "eachArrive": [],
    "parallelDo": "var lastTime = core.getFlag('lastTime', 0);\n\nif (Date.now() - lastTime > 20) {\n\tvar image = core.material.images.images['14.jpg'];\n\tvar width = 416,\n\t\theight = 416;\n\n\tcore.canvas.bg.translate(width / 2, height / 2);\n\tcore.canvas.bg.rotate(Math.PI / 180 / 6);\n\tcore.canvas.bg.translate(-width / 2, -height / 2);\n\tcore.canvas.bg.drawImage(image, -288, -96);\n\n\tcore.setFlag('lastTime', Date.now());\n\n\tvar rotateTime = core.getFlag('rotateTime', 0);\n\trotateTime += 1;\n\tif (rotateTime >= 6 * 180) {\n\t\trotateTime -= 6 * 180;\n\t}\n\tcore.setFlag('rotateTime', rotateTime);\n}",
    "events": {
        "2,11": [
            {
                "type": "jumpHero",
                "loc": [
                    2,
                    4
                ],
                "time": 500
            },
            {
                "type": "trigger",
                "loc": [
                    2,
                    4
                ]
            }
        ],
        "0,11": [
            {
                "type": "jumpHero",
                "loc": [
                    0,
                    7
                ],
                "time": 500
            },
            {
                "type": "trigger",
                "loc": [
                    0,
                    7
                ]
            }
        ],
        "0,3": [
            {
                "type": "jumpHero",
                "loc": [
                    0,
                    7
                ],
                "time": 500
            },
            {
                "type": "trigger",
                "loc": [
                    0,
                    7
                ]
            }
        ],
        "1,2": [
            {
                "type": "jumpHero",
                "loc": [
                    8,
                    2
                ],
                "time": 500
            },
            {
                "type": "trigger",
                "loc": [
                    8,
                    2
                ]
            }
        ],
        "7,2": [
            {
                "type": "jumpHero",
                "loc": [
                    0,
                    2
                ],
                "time": 500
            },
            {
                "type": "trigger",
                "loc": [
                    0,
                    2
                ]
            }
        ],
        "3,4": [
            {
                "type": "jumpHero",
                "loc": [
                    6,
                    4
                ],
                "time": 500
            },
            {
                "type": "trigger",
                "loc": [
                    6,
                    4
                ]
            }
        ],
        "5,4": [
            {
                "type": "jumpHero",
                "loc": [
                    2,
                    4
                ],
                "time": 500
            },
            {
                "type": "trigger",
                "loc": [
                    2,
                    4
                ]
            }
        ],
        "2,5": [
            {
                "type": "jumpHero",
                "loc": [
                    2,
                    12
                ],
                "time": 500
            },
            {
                "type": "trigger",
                "loc": [
                    2,
                    12
                ]
            }
        ],
        "4,7": [
            {
                "type": "jumpHero",
                "loc": [
                    4,
                    10
                ],
                "time": 500
            },
            {
                "type": "trigger",
                "loc": [
                    4,
                    10
                ]
            }
        ],
        "4,9": [
            {
                "type": "jumpHero",
                "loc": [
                    4,
                    6
                ],
                "time": 500
            },
            {
                "type": "trigger",
                "loc": [
                    4,
                    6
                ]
            }
        ],
        "5,10": [
            {
                "type": "jumpHero",
                "loc": [
                    12,
                    10
                ],
                "time": 500
            },
            {
                "type": "trigger",
                "loc": [
                    12,
                    10
                ]
            }
        ],
        "11,10": [
            {
                "type": "jumpHero",
                "loc": [
                    4,
                    10
                ],
                "time": 500
            },
            {
                "type": "trigger",
                "loc": [
                    4,
                    10
                ]
            }
        ],
        "6,5": [
            {
                "type": "jumpHero",
                "loc": [
                    6,
                    8
                ],
                "time": 500
            },
            {
                "type": "trigger",
                "loc": [
                    6,
                    8
                ]
            }
        ],
        "6,7": [
            {
                "type": "jumpHero",
                "loc": [
                    6,
                    4
                ],
                "time": 500
            },
            {
                "type": "trigger",
                "loc": [
                    6,
                    4
                ]
            }
        ],
        "7,8": [
            {
                "type": "jumpHero",
                "loc": [
                    10,
                    8
                ],
                "time": 500
            },
            {
                "type": "trigger",
                "loc": [
                    10,
                    8
                ]
            }
        ],
        "9,8": [
            {
                "type": "jumpHero",
                "loc": [
                    6,
                    8
                ],
                "time": 500
            },
            {
                "type": "trigger",
                "loc": [
                    6,
                    8
                ]
            }
        ],
        "10,7": [
            {
                "type": "jumpHero",
                "loc": [
                    10,
                    0
                ],
                "time": 500
            },
            {
                "type": "trigger",
                "loc": [
                    10,
                    0
                ]
            }
        ],
        "10,1": [
            {
                "type": "jumpHero",
                "loc": [
                    10,
                    8
                ],
                "time": 500
            },
            {
                "type": "trigger",
                "loc": [
                    10,
                    8
                ]
            }
        ],
        "7,6": [
            {
                "type": "jumpHero",
                "loc": [
                    4,
                    6
                ],
                "time": 500
            },
            {
                "type": "trigger",
                "loc": [
                    4,
                    6
                ]
            }
        ],
        "5,6": [
            {
                "type": "jumpHero",
                "loc": [
                    8,
                    6
                ],
                "time": 500
            },
            {
                "type": "trigger",
                "loc": [
                    8,
                    6
                ]
            }
        ],
        "12,9": [
            {
                "type": "jumpHero",
                "loc": [
                    12,
                    5
                ],
                "time": 500
            },
            {
                "type": "trigger",
                "loc": [
                    12,
                    5
                ]
            }
        ],
        "12,1": [
            {
                "type": "jumpHero",
                "loc": [
                    12,
                    5
                ],
                "time": 500
            },
            {
                "type": "trigger",
                "loc": [
                    12,
                    5
                ]
            }
        ],
        "8,5": [
            {
                "type": "jumpHero",
                "loc": [
                    8,
                    2
                ],
                "time": 500
            },
            {
                "type": "trigger",
                "loc": [
                    8,
                    2
                ]
            }
        ],
        "8,3": [
            {
                "type": "jumpHero",
                "loc": [
                    8,
                    6
                ],
                "time": 500
            },
            {
                "type": "trigger",
                "loc": [
                    8,
                    6
                ]
            }
        ],
        "0,8": [
            {
                "type": "jumpHero",
                "loc": [
                    0,
                    12
                ],
                "time": 500
            },
            {
                "type": "trigger",
                "loc": [
                    0,
                    12
                ]
            }
        ],
        "0,6": [
            {
                "type": "jumpHero",
                "loc": [
                    0,
                    2
                ],
                "time": 500
            },
            {
                "type": "trigger",
                "loc": [
                    0,
                    2
                ]
            }
        ],
        "12,4": [
            {
                "type": "jumpHero",
                "loc": [
                    12,
                    0
                ],
                "time": 500
            },
            {
                "type": "trigger",
                "loc": [
                    12,
                    0
                ]
            }
        ],
        "12,6": [
            {
                "type": "jumpHero",
                "loc": [
                    12,
                    10
                ],
                "time": 500
            },
            {
                "type": "trigger",
                "loc": [
                    12,
                    10
                ]
            }
        ],
        "6,3": [
            "喵？"
        ],
        "6,2": [
            "你要做什么？"
        ],
        "6,1": [
            "等一下，这个是可以推着跑的嘛？\n尾迹还会留下黑域！"
        ],
        "6,0": [
            {
                "type": "if",
                "condition": "item:I1479==0",
                "true": [
                    "得到了幸运箭头 - ↓！\n为什么推的是上箭头，最后得到了这个……\n补充了3个换位标靶。",
                    {
                        "type": "setValue",
                        "name": "item:I1479",
                        "value": "1"
                    },
                    {
                        "type": "setValue",
                        "name": "item:I733",
                        "operator": "+=",
                        "value": "3"
                    }
                ],
                "false": [
                    "为什么推的是上箭头，最后得到了这个……"
                ]
            }
        ]
    },
    "changeFloor": {
        "1,12": {
            "floorId": ":before",
            "stair": "upFloor"
        },
        "11,0": {
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
    [ 17, 17, 17, 17, 17, 17, 17, 17, 17, 17,  0, 87,  0],
    [ 17, 17, 17, 17, 17, 17, 17, 17, 17, 17,180011,180011,180011],
    [2000,672, 17, 17, 17, 17, 17,671,1999, 17, 17, 17, 17],
    [180011, 17, 17, 17, 17, 17,673, 17,180011, 17, 17, 17, 17],
    [ 17, 17,2003,672, 17,671,2001, 17, 17, 17, 17, 17,673],
    [ 17, 17,180011, 17, 17, 17,180011, 17,673, 17, 17, 17,2014],
    [673, 17, 17, 17,2002,672, 17,671,2002, 17, 17, 17,180011],
    [2014, 17, 17, 17,180011, 17,673, 17,180011, 17,673, 17, 17],
    [180011, 17, 17, 17, 17, 17,2001,672, 17,671,2003, 17, 17],
    [ 17, 17, 17, 17,673, 17,180011, 17, 17, 17,180011, 17,673],
    [ 17, 17, 17, 17,1999,672, 17, 17, 17, 17, 17,671,2000],
    [673, 17,673, 17,180011, 17, 17, 17, 17, 17, 17, 17,180011],
    [  0, 88,  0, 17, 17, 17, 17, 17, 17, 17, 17, 17, 17]
],
    "bgmap": [

],
    "fgmap": [
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,670,  0,670],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [670,  0,  0,  0,  0,  0,  0,  0,670,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,670,  0,  0,  0,670,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,670],
    [  0,  0,  0,  0,670,  0,  0,  0,  0,  0,  0,  0,  0],
    [670,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0]
],
    "bg2map": [
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,180003,180003,180003],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [180003,  0,  0,  0,  0,  0,  0,  0,180003,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,180003,  0,  0,  0,180003,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,180003],
    [  0,  0,  0,  0,180003,  0,  0,  0,180003,  0,  0,  0,  0],
    [180003,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,180003,  0,  0,  0,180003,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,180003,  0,  0,  0,  0,  0,  0,  0,180003],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [180003,180003,180003,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0]
],
    "fg2map": [

]
}
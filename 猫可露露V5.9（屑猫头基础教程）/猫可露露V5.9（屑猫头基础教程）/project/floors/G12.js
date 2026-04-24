main.floors.G12=
{
    "floorId": "G12",
    "title": "心境 G12",
    "name": "心境 G12",
    "width": 13,
    "height": 13,
    "canFlyTo": true,
    "canFlyFrom": true,
    "canUseQuickShop": true,
    "cannotViewMap": false,
    "images": [],
    "ratio": 100000000,
    "defaultGround": 330410,
    "bgm": "25.mp3",
    "firstArrive": [
        {
            "type": "animate",
            "name": "chaoju",
            "loc": [
                5,
                0
            ],
            "async": true
        },
        {
            "type": "animate",
            "name": "chaoju",
            "loc": [
                7,
                0
            ]
        },
        {
            "type": "hide",
            "loc": [
                [
                    6,
                    0
                ]
            ],
            "time": 1500
        },
        "\t[纳可]咦……\n心境之门，消失了。",
        "\t[纳可]那两只暗茸茸，有古怪。"
    ],
    "eachArrive": [],
    "parallelDo": "",
    "events": {
        "6,0": [
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
                        "reason": "第七心境"
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
                        "reason": "第七心境"
                    }
                ]
            }
        ]
    },
    "changeFloor": {
        "11,8": {
            "floorId": ":before",
            "stair": "upFloor"
        },
        "6,11": {
            "floorId": ":next",
            "stair": "downFloor"
        }
    },
    "beforeBattle": {},
    "afterBattle": {
        "5,0": [
            {
                "type": "setValue",
                "name": "flag:xin7",
                "operator": "+=",
                "value": "1"
            },
            {
                "type": "if",
                "condition": "(flag:xin7==2)",
                "true": [
                    {
                        "type": "show",
                        "loc": [
                            [
                                6,
                                0
                            ]
                        ],
                        "time": 500
                    }
                ],
                "false": []
            }
        ],
        "7,0": [
            {
                "type": "setValue",
                "name": "flag:xin7",
                "operator": "+=",
                "value": "1"
            },
            {
                "type": "if",
                "condition": "(flag:xin7==2)",
                "true": [
                    {
                        "type": "show",
                        "loc": [
                            [
                                6,
                                0
                            ]
                        ],
                        "time": 500
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
    [1324,1404,1013,  0,644,1336,996,1336,1014,  0,1009,1404,1324],
    [330418,330418,330418,330418,330418,330418,330418,330418,330418,330418,330418,330418,330418],
    [330426,330426,330425,330426,330426,330426,330426,330426,330426,330426,330427,330426,330426],
    [330434,330434,330425,330426,330426,330426,330426,330426,330426,330426,330427,330434,330434],
    [622, 15,330433,330434,330434,330434,330434,330434,330434,330434,330435, 15,622],
    [185,  0,1251,  0, 82,1404,1010,185,638,  0,1251,  0,185],
    [185,640,185,621,185,1010,1333, 83,640,621,185,639,185],
    [185, 81,185, 81,185,185,185,185,1335,185,185,185,185],
    [185, 21,185,1401,620, 81,1333,  0,639,1251,  0, 88,185],
    [185,639,1300,621,185,185,185,1330,185,185,185, 15,185],
    [185,185,1335,330635, 22,185,  0,622,  0,185,640,1325,185],
    [185,635,  0,1405,  0,185, 87,645,622,1250,  0, 21,185],
    [1324,185,638,185, 23,185,185,185,185,185,185,185,1324]
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
main.floors.JC18=
{
    "floorId": "JC18",
    "title": "基础 18 层",
    "name": "基础 18 层",
    "width": 13,
    "height": 13,
    "canFlyTo": true,
    "canFlyFrom": true,
    "canUseQuickShop": true,
    "cannotViewMap": false,
    "images": [],
    "ratio": 10,
    "defaultGround": 30060,
    "bgm": "j3.mp3",
    "firstArrive": [
        {
            "type": "animate",
            "name": "baozha",
            "loc": [
                6,
                1
            ]
        },
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
            "type": "setEnemyOnPoint",
            "loc": [
                [
                    6,
                    1
                ]
            ],
            "name": "atk",
            "operator": "*=",
            "value": "0.32"
        },
        {
            "type": "setEnemyOnPoint",
            "loc": [
                [
                    6,
                    1
                ]
            ],
            "name": "def",
            "operator": "*=",
            "value": "0.3"
        },
        {
            "type": "setEnemyOnPoint",
            "loc": [
                [
                    6,
                    1
                ]
            ],
            "name": "hp",
            "operator": "*=",
            "value": "0.32"
        },
        {
            "type": "hide",
            "loc": [
                [
                    6,
                    3
                ]
            ],
            "remove": true,
            "time": 500
        }
    ],
    "eachArrive": [],
    "parallelDo": "",
    "events": {},
    "changeFloor": {
        "6,0": {
            "floorId": ":next",
            "stair": "downFloor"
        },
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
                "name": "flag:door_JC18_9_10",
                "operator": "+=",
                "value": "1"
            }
        ],
        "10,11": [
            {
                "type": "setValue",
                "name": "flag:door_JC18_9_10",
                "operator": "+=",
                "value": "1"
            }
        ],
        "7,9": [
            {
                "type": "setValue",
                "name": "flag:door_JC18_6_10",
                "operator": "+=",
                "value": "1"
            }
        ],
        "7,11": [
            {
                "type": "setValue",
                "name": "flag:door_JC18_6_10",
                "operator": "+=",
                "value": "1"
            }
        ],
        "4,9": [
            {
                "type": "setValue",
                "name": "flag:door_JC18_3_10",
                "operator": "+=",
                "value": "1"
            }
        ],
        "4,11": [
            {
                "type": "setValue",
                "name": "flag:door_JC18_3_10",
                "operator": "+=",
                "value": "1"
            }
        ],
        "1,7": [
            {
                "type": "setValue",
                "name": "flag:door_JC18_2_6",
                "operator": "+=",
                "value": "1"
            }
        ],
        "3,7": [
            {
                "type": "setValue",
                "name": "flag:door_JC18_2_6",
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
                "condition": "flag:door_JC18_9_10==2",
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
                        "name": "flag:door_JC18_9_10",
                        "operator": "=",
                        "value": "null"
                    }
                ]
            }
        },
        "6,10": {
            "0": {
                "condition": "flag:door_JC18_6_10==2",
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
                        "name": "flag:door_JC18_6_10",
                        "operator": "=",
                        "value": "null"
                    }
                ]
            }
        },
        "3,10": {
            "0": {
                "condition": "flag:door_JC18_3_10==2",
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
                        "name": "flag:door_JC18_3_10",
                        "operator": "=",
                        "value": "null"
                    }
                ]
            }
        },
        "2,6": {
            "0": {
                "condition": "flag:door_JC18_2_6==2",
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
                        "name": "flag:door_JC18_2_6",
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
    [150111,150111,150111,150111,150111,150074, 87,150072,150111,150111,150111,150111,150111],
    [150119,150119,150119,150119,150119,150082,355,150080,150119,150119,150119,150119,150119],
    [150127,150127,150127,150127,150127,150090,  0,150088,150127,150127,150127,150127,150127],
    [  4,584,  0,635,  0,  0,891,  0,  0,635,  0,584,  4],
    [  4,  4, 60,  0,641,  0,640,  0,641,  0, 60,  4,  4],
    [  4,  4,  0,636,  0,579,  0,579,  0,636,  0,  4,  4],
    [  4,  4, 85,  4,  4,  4,  4,  4,  4,  4, 83,  4,  4],
    [144,280,  0,280,144,150387,144, 88,  0,585,  0, 60,144],
    [144,144,587,144,144,144,144,144,144,144,144, 86,144],
    [144,144,  0,144,325,144,144,278,144,144,257,  0,144],
    [144,144,639, 85,  0,635, 85,  0,641, 85,  0,584,144],
    [144,144,144,144,325,144,144,278,144,144,257,144,144],
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

],
    "fg2map": [

]
}